// くわしい解析: 条件別の勝率、対面との差、デスの内訳、連戦の傾向、試合ごとの採点。DOMには触れない。
import { BENCH, scale } from "./bench";
import type { MatchStat, Role } from "./types";

/** ある条件に当てはまる試合の数と、そのうちの勝ち数 */
export interface Split {
  games: number;
  wins: number;
}

export const winRateOf = (split: Split): number => (split.games > 0 ? split.wins / split.games : 0);

export interface LaneDetail {
  /** 対面との差が取れた試合の数 */
  games: number;
  /** レーン戦で対面より上だった試合の割合(0〜1)。分からなければ null */
  wonRate: number | null;
  /** 試合終了時の対面との差(平均) */
  csDiff: number | null;
  goldDiff: number | null;
  /** 10分・15分時点の対面との差(平均)。タイムラインが取れた試合だけ */
  csDiff10: number | null;
  goldDiff10: number | null;
  goldDiff15: number | null;
  /** 10分までのキル+アシスト(1試合あたり) */
  takedowns10: number | null;
}

export interface DeathDetail {
  /** 時刻の分かったデスの合計 */
  counted: number;
  /** 10分までに死んだ数(1試合あたり) */
  per10: number;
  /** デス全体のうち、〜10分 / 10〜25分 / 25分〜 の割合(0〜1) */
  early: number;
  mid: number;
  late: number;
  /** 相手1人にやられたデスの割合 */
  solo: number;
  /** 相手側の陣地で死んだデスの割合 */
  deep: number;
}

export interface Detail {
  side: { blue: Split; red: Split };
  /** 試合の長さ: 25分未満 / 25〜35分 / 35分以上 */
  length: { short: Split; mid: Split; long: Split };
  queue: { ranked: Split; normal: Split };
  /** 始めた時刻: 朝(5〜11時) / 昼(11〜17時) / 夜(17〜24時) / 深夜(0〜5時) */
  time: { morning: Split; day: Split; evening: Split; night: Split };
  /** 直近5試合と、それより前 */
  recent: Split;
  earlier: Split;
  /** 負けた / 勝った試合が終わって20分以内に始めた試合 */
  afterLoss: Split;
  afterWin: Split;
  /** 休みなく(前の試合が終わって30分以内に)続けた最多の試合数 */
  longestSession: number;
  /** 降参で終わった負け試合の数 */
  surrenders: number;
  lane: LaneDetail;
  /** 15分時点で対面に1000ゴールド以上勝っていた / 負けていた試合 */
  ahead15: Split;
  behind15: Split;
  /** タイムラインが1試合も取れていなければ null */
  deaths: DeathDetail | null;
  /** 味方が取ったドラゴン・バロン・ヘラルドのうち、自分が絡んだ割合(0〜1) */
  objectiveShare: number;
  /** 1試合あたり */
  plates: number;
  ccSec: number;
  dodged: number;
  pings: number;
  missingPings: number;
  /** 1分あたりの、味方への回復+シールド */
  healShieldPerMin: number;
  /** 奪ったドラゴン・バロンの合計 */
  steals: number;
  /** 各試合の出来(0〜100)。matches と同じ並び */
  scores: number[];
  bestGame: MatchStat;
  /** 青側と赤側の両方で5試合以上あり、勝率が40ポイント以上ちがうとき、苦手な側 */
  weakSide: "blue" | "red" | null;
}

const kdaOf = (m: MatchStat): number => (m.kills + m.assists) / Math.max(1, m.deaths);
const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
const known = <T>(values: readonly (T | null)[]): T[] => values.filter((v): v is T => v !== null);

function split(matches: readonly MatchStat[], on: (m: MatchStat) => boolean): Split {
  const hit = matches.filter(on);
  return { games: hit.length, wins: hit.filter((m) => m.win).length };
}

const SESSION_GAP_MS = 30 * 60 * 1000;
const REQUEUE_GAP_MS = 20 * 60 * 1000;
const endOf = (m: MatchStat): number => m.gameStart + m.durationSec * 1000;

/** 1試合の出来を 0〜100 にする。その試合のロールの目安で見る */
export function scoreMatch(m: MatchStat): number {
  const bench = BENCH[m.role];
  const minutes = Math.max(1, m.durationSec / 60);
  const parts = [
    scale(kdaOf(m), [1, 5]),
    scale(m.teamKills > 0 ? (m.kills + m.assists) / m.teamKills : 0, bench.kp),
    scale(m.teamDamage > 0 ? m.damage / m.teamDamage : 0, bench.dmg),
    scale((m.deaths / minutes) * 30, [9, 3]),
    scale(m.visionScore / minutes, bench.vision),
  ];
  // サポートはCSで測らない
  if (m.role !== "UTILITY") parts.push(scale(m.cs / minutes, bench.cs));
  const base = parts.reduce((a, b) => a + b, 0) / parts.length;
  // 勝ち負けは少しだけ効かせる(内容の悪い勝ち、内容の良い負けを区別できるように)
  return Math.round(Math.max(0, Math.min(100, base + (m.win ? 5 : -5))));
}

/**
 * @param matches 新しい順
 * @param onRole メインロールの試合(対面との差はロールで意味が変わるので、これだけで見る)
 * @param utcOffsetMinutes 始めた時刻を見るときの時差(日本なら 540)
 */
export function computeDetail(
  matches: readonly MatchStat[],
  onRole: readonly MatchStat[],
  mainRole: Role,
  utcOffsetMinutes: number,
): Detail {
  const games = matches.length;
  const hourOf = (m: MatchStat): number => {
    const local = new Date(m.gameStart + utcOffsetMinutes * 60 * 1000);
    return local.getUTCHours();
  };

  // 古い順にたどって、連戦と「負けた直後」を数える
  const oldestFirst = [...matches].sort((a, b) => a.gameStart - b.gameStart);
  const afterLoss: Split = { games: 0, wins: 0 };
  const afterWin: Split = { games: 0, wins: 0 };
  let longestSession = games > 0 ? 1 : 0;
  let session = 1;
  for (let i = 1; i < oldestFirst.length; i++) {
    const previous = oldestFirst[i - 1];
    const current = oldestFirst[i];
    const gap = current.gameStart - endOf(previous);
    session = gap <= SESSION_GAP_MS ? session + 1 : 1;
    longestSession = Math.max(longestSession, session);
    if (gap <= REQUEUE_GAP_MS) {
      const bucket = previous.win ? afterWin : afterLoss;
      bucket.games += 1;
      if (current.win) bucket.wins += 1;
    }
  }

  const withLane = onRole.filter((m) => m.goldDiff !== null);
  const withTimeline = matches.filter((m) => m.timeline !== null);
  const roleTimelines = known(onRole.map((m) => m.timeline));
  const laneWon = known(onRole.map((m) => m.laneWon));
  const lane: LaneDetail = {
    games: withLane.length,
    wonRate: laneWon.length === 0 ? null : laneWon.filter(Boolean).length / laneWon.length,
    csDiff: mean(known(onRole.map((m) => m.csDiff))),
    goldDiff: mean(known(onRole.map((m) => m.goldDiff))),
    csDiff10: mean(known(roleTimelines.map((t) => t.csDiff10))),
    goldDiff10: mean(known(roleTimelines.map((t) => t.goldDiff10))),
    goldDiff15: mean(known(roleTimelines.map((t) => t.goldDiff15))),
    takedowns10: mean(roleTimelines.map((t) => t.takedowns10)),
  };

  const diff15 = (m: MatchStat): number | null => m.timeline?.goldDiff15 ?? null;
  const ahead15 = split(matches, (m) => (diff15(m) ?? 0) >= 1000);
  const behind15 = split(matches, (m) => (diff15(m) ?? 0) <= -1000);

  let deaths: DeathDetail | null = null;
  if (withTimeline.length > 0) {
    const times = withTimeline.flatMap((m) => m.timeline?.deathMinutes ?? []);
    const counted = times.length;
    const share = (n: number): number => (counted > 0 ? n / counted : 0);
    const early = times.filter((t) => t <= 10).length;
    const late = times.filter((t) => t > 25).length;
    deaths = {
      counted,
      per10: early / withTimeline.length,
      early: share(early),
      mid: share(counted - early - late),
      late: share(late),
      solo: share(withTimeline.reduce((total, m) => total + (m.timeline?.soloDeaths ?? 0), 0)),
      deep: share(withTimeline.reduce((total, m) => total + (m.timeline?.deepDeaths ?? 0), 0)),
    };
  }

  const side = { blue: split(matches, (m) => m.side === "blue"), red: split(matches, (m) => m.side === "red") };
  let weakSide: Detail["weakSide"] = null;
  if (side.blue.games >= 5 && side.red.games >= 5) {
    const gap = winRateOf(side.blue) - winRateOf(side.red);
    if (Math.abs(gap) >= 0.4) weakSide = gap > 0 ? "red" : "blue";
  }

  const scores = matches.map(scoreMatch);
  const bestIndex = scores.reduce((best, score, i) => (score > scores[best] ? i : best), 0);
  const perGame = (f: (m: MatchStat) => number): number => (games > 0 ? matches.reduce((t, m) => t + f(m), 0) / games : 0);
  const teamObjectives = onRole.reduce((t, m) => t + m.teamObjectives, 0);
  // サポート以外の回復量はチャンピオンしだいなので、メインロールの試合だけで見る
  const roleMinutes = onRole.reduce((t, m) => t + m.durationSec, 0) / 60;

  return {
    side,
    length: {
      short: split(matches, (m) => m.durationSec < 25 * 60),
      mid: split(matches, (m) => m.durationSec >= 25 * 60 && m.durationSec < 35 * 60),
      long: split(matches, (m) => m.durationSec >= 35 * 60),
    },
    queue: {
      ranked: split(matches, (m) => m.queueId === 420 || m.queueId === 440),
      normal: split(matches, (m) => m.queueId !== 420 && m.queueId !== 440),
    },
    time: {
      morning: split(matches, (m) => hourOf(m) >= 5 && hourOf(m) < 11),
      day: split(matches, (m) => hourOf(m) >= 11 && hourOf(m) < 17),
      evening: split(matches, (m) => hourOf(m) >= 17),
      night: split(matches, (m) => hourOf(m) < 5),
    },
    recent: split(matches.slice(0, 5), () => true),
    earlier: split(matches.slice(5), () => true),
    afterLoss,
    afterWin,
    longestSession,
    surrenders: matches.filter((m) => m.surrendered).length,
    lane,
    ahead15,
    behind15,
    deaths,
    objectiveShare: teamObjectives > 0 ? Math.min(1, onRole.reduce((t, m) => t + m.objectives, 0) / teamObjectives) : 0,
    plates: mainRole === "UTILITY" || mainRole === "JUNGLE" ? 0 : onRole.reduce((t, m) => t + m.turretPlates, 0) / Math.max(1, onRole.length),
    ccSec: perGame((m) => m.ccSec),
    dodged: perGame((m) => m.skillshotsDodged),
    pings: perGame((m) => m.pings),
    missingPings: perGame((m) => m.missingPings),
    healShieldPerMin: roleMinutes > 0 ? onRole.reduce((t, m) => t + m.healShield, 0) / roleMinutes : 0,
    steals: matches.reduce((t, m) => t + m.epicSteals, 0),
    scores,
    bestGame: matches[bestIndex],
    weakSide,
  };
}
