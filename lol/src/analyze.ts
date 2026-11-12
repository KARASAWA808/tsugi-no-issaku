// 試合の成績から、6つの軸の点数と「強み」「弱み」を出す。DOMには触れない。
import { BENCH, scale } from "./bench";
import { type Detail, computeDetail, winRateOf } from "./detail";
import type { MatchStat, PlayerData, Role } from "./types";

export { scale };

export type AxisKey = "laning" | "fighting" | "vision" | "survival" | "objective" | "consistency";

export interface Axis {
  key: AxisKey;
  label: string;
  /** 0〜100。50がそのロールの「ふつう」 */
  score: number;
}

export type StrengthId =
  | "kda" | "cs" | "vision" | "teamfight" | "damage" | "solokill" | "survive"
  | "objective" | "onetrick" | "winrate" | "firstblood" | "pool" | "multikill"
  // ここから下は、くわしい解析から出る強み
  | "lanewin" | "comeback" | "lategame" | "plates" | "healer" | "cc" | "dodger" | "form" | "steal";

export type WeaknessId =
  | "feeder" | "grayscreen" | "lowcs" | "loselane" | "blind" | "nopink" | "afk" | "lowdamage"
  | "kdaplayer" | "coinflip" | "tourist" | "losing" | "nomad" | "noobjective"
  // ここから下は、くわしい解析から出る弱み
  | "behind15" | "earlydeath" | "deepdeath" | "solodeath" | "thrower" | "tilt" | "marathon"
  | "nightloss" | "ff" | "pinger" | "slump" | "sidegap" | "latelose" | "badchamp";

export interface Trait<T extends string> {
  id: T;
  /** 0〜1。大きいほどはっきり出ている */
  strength: number;
}

export interface ChampionSummary {
  champion: string;
  games: number;
  wins: number;
  kda: number;
}

export interface Averages {
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  csPerMin: number;
  /** 10分時点のCS。1試合も取れていなければ null */
  csAt10: number | null;
  goldPerMin: number;
  damagePerMin: number;
  /** チームの与ダメージに占める割合(0〜1) */
  damageShare: number;
  /** キル関与率(0〜1) */
  killParticipation: number;
  visionPerMin: number;
  controlWards: number;
  wardsKilled: number;
  soloKills: number;
  /** 30分あたりのデス数 */
  deathsPer30: number;
  /** 試合時間のうち死んでいた割合(0〜1) */
  deadShare: number;
  firstBloodRate: number;
  objectives: number;
  turrets: number;
  durationMin: number;
}

export interface Analysis {
  games: number;
  wins: number;
  winRate: number;
  mainRole: Role;
  /** メインロールの試合の割合(0〜1) */
  roleShare: number;
  /** 試合数の多い順 */
  champions: ChampionSummary[];
  /** CS・視界・ダメージ割合などロールで基準が変わる項目はメインロールの試合だけ、ほかは全試合の平均 */
  avg: Averages;
  axes: Axis[];
  overall: number;
  grade: Grade;
  /** はっきり出ている順 */
  strengths: Trait<StrengthId>[];
  weaknesses: Trait<WeaknessId>[];
  /** いちばんデスの多かった試合 */
  worstGame: MatchStat;
  /** 9デス以上か、KDAが1を切った試合の割合 */
  disasterRate: number;
  longestLosingStreak: number;
  largestMultiKill: number;
  /** 条件別の勝率、対面との差、デスの内訳など */
  detail: Detail;
  /** 4試合以上使って勝率が25%以下のチャンピオン(いちばん試合数の多いもの)。なければ null */
  badChampion: ChampionSummary | null;
}

export interface AnalyzeOptions {
  /** 始めた時刻を見るときの時差(分)。省くと、動かしている環境の時差 */
  utcOffsetMinutes?: number;
}

export type Grade = "S" | "A" | "B" | "C" | "D";

export const AXIS_LABELS: Record<AxisKey, string> = {
  laning: "レーン戦",
  fighting: "集団戦",
  vision: "視界",
  survival: "生存",
  objective: "オブジェクト",
  consistency: "安定感",
};

const sum = (list: readonly MatchStat[], f: (m: MatchStat) => number): number =>
  list.reduce((total, m) => total + f(m), 0);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);

const kdaOf = (kills: number, deaths: number, assists: number): number => (kills + assists) / Math.max(1, deaths);

function averages(list: readonly MatchStat[]): Averages {
  const n = list.length;
  const minutes = sum(list, (m) => m.durationSec) / 60;
  const kills = sum(list, (m) => m.kills);
  const deaths = sum(list, (m) => m.deaths);
  const assists = sum(list, (m) => m.assists);
  const cs10 = list.flatMap((m) => (m.csAt10 === null ? [] : [m.csAt10]));
  return {
    kills: ratio(kills, n),
    deaths: ratio(deaths, n),
    assists: ratio(assists, n),
    kda: kdaOf(kills, deaths, assists),
    csPerMin: ratio(sum(list, (m) => m.cs), minutes),
    csAt10: cs10.length === 0 ? null : mean(cs10),
    goldPerMin: ratio(sum(list, (m) => m.gold), minutes),
    damagePerMin: ratio(sum(list, (m) => m.damage), minutes),
    damageShare: ratio(sum(list, (m) => m.damage), sum(list, (m) => m.teamDamage)),
    killParticipation: ratio(kills + assists, sum(list, (m) => m.teamKills)),
    visionPerMin: ratio(sum(list, (m) => m.visionScore), minutes),
    controlWards: ratio(sum(list, (m) => m.controlWards), n),
    wardsKilled: ratio(sum(list, (m) => m.wardsKilled), n),
    soloKills: ratio(sum(list, (m) => m.soloKills), n),
    deathsPer30: ratio(deaths, minutes) * 30,
    deadShare: ratio(sum(list, (m) => m.timeDeadSec), sum(list, (m) => m.durationSec)),
    firstBloodRate: ratio(list.filter((m) => m.firstBlood).length, n),
    objectives: ratio(sum(list, (m) => m.objectives), n),
    turrets: ratio(sum(list, (m) => m.turretTakedowns), n),
    durationMin: ratio(minutes, n),
  };
}

function mainRoleOf(matches: readonly MatchStat[]): { role: Role; share: number } {
  const counts = new Map<Role, number>();
  for (const m of matches) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  let role: Role = "UNKNOWN";
  let best = 0;
  // 同数なら先に出てきた(=新しい試合の)ロールを取る。UNKNOWN はほかに何もないときだけ
  for (const [r, c] of counts) {
    if (r !== "UNKNOWN" && c > best) {
      role = r;
      best = c;
    }
  }
  if (best === 0) return { role: "UNKNOWN", share: 1 };
  return { role, share: best / matches.length };
}

function championsOf(matches: readonly MatchStat[]): ChampionSummary[] {
  const byChampion = new Map<string, MatchStat[]>();
  for (const m of matches) {
    const list = byChampion.get(m.champion);
    if (list) list.push(m);
    else byChampion.set(m.champion, [m]);
  }
  return [...byChampion]
    .map(([champion, list]) => ({
      champion,
      games: list.length,
      wins: list.filter((m) => m.win).length,
      kda: kdaOf(sum(list, (m) => m.kills), sum(list, (m) => m.deaths), sum(list, (m) => m.assists)),
    }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins || a.champion.localeCompare(b.champion));
}

function longestLosingStreak(matches: readonly MatchStat[]): number {
  let longest = 0;
  let current = 0;
  for (const m of matches) {
    current = m.win ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function gradeOf(overall: number): Grade {
  if (overall >= 80) return "S";
  if (overall >= 67) return "A";
  if (overall >= 54) return "B";
  if (overall >= 41) return "C";
  return "D";
}

const isDisaster = (m: MatchStat): boolean => m.deaths >= 9 || kdaOf(m.kills, m.deaths, m.assists) < 1;

/** 点数が line から端(0 か 100)までのどこにあるかを 0〜1 にする。強み・弱みの「はっきり度」に使う */
const above = (score: number, line: number): number => Math.max(0, (score - line) / (100 - line));
const below = (score: number, line: number): number => Math.max(0, (line - score) / line);

/** 試合が1つもなければ null */
export function analyze(player: PlayerData, options: AnalyzeOptions = {}): Analysis | null {
  const matches = player.matches;
  if (matches.length === 0) return null;

  const games = matches.length;
  const wins = matches.filter((m) => m.win).length;
  const winRate = wins / games;
  const { role: mainRole, share: roleShare } = mainRoleOf(matches);
  const onRole = mainRole === "UNKNOWN" ? matches : matches.filter((m) => m.role === mainRole);
  const all = averages(matches);
  const main = averages(onRole);
  // ロールで基準が変わる項目は、メインロールの試合だけで見る(サポートを数戦やっただけでCSが落ちないように)
  const avg: Averages = {
    ...all,
    csPerMin: main.csPerMin,
    csAt10: main.csAt10,
    damageShare: main.damageShare,
    killParticipation: main.killParticipation,
    visionPerMin: main.visionPerMin,
    controlWards: main.controlWards,
    soloKills: main.soloKills,
    objectives: main.objectives,
  };
  const bench = BENCH[mainRole];
  const support = mainRole === "UTILITY";
  const champions = championsOf(matches);
  const disasterRate = matches.filter(isDisaster).length / games;
  const largestMultiKill = Math.max(...matches.map((m) => m.largestMultiKill));
  const detail = computeDetail(matches, onRole, mainRole, options.utcOffsetMinutes ?? -new Date().getTimezoneOffset());
  const badChampion =
    champions.find((c) => c.games >= 4 && c.wins / c.games <= 0.25 && winRate - c.wins / c.games >= 0.1) ?? null;

  const s = {
    cs: scale(avg.csPerMin, bench.cs),
    cs10: avg.csAt10 === null ? null : scale(avg.csAt10, bench.cs10),
    solo: scale(avg.soloKills, bench.solo),
    kda: scale(avg.kda, [1.5, 4.5]),
    kp: scale(avg.killParticipation, bench.kp),
    dmg: scale(avg.damageShare, bench.dmg),
    vision: scale(avg.visionPerMin, bench.vision),
    pinks: scale(avg.controlWards, bench.pinks),
    deaths: scale(avg.deathsPer30, [8, 3.5]),
    dead: scale(avg.deadShare, [0.18, 0.06]),
    obj: scale(avg.objectives, bench.obj),
    turrets: scale(avg.turrets, [0.8, 3.5]),
    firstBlood: scale(avg.firstBloodRate, [0.05, 0.3]),
    disaster: scale(disasterRate, [0.4, 0.05]),
    focus: scale(ratio(sum3(champions), games), [0.4, 0.85]),
  };

  // サポートのレーン戦はCSで測れないので、序盤の絡みとKDAで代える
  const laning = support
    ? mean([s.firstBlood, s.kda])
    : mean([s.cs, ...(s.cs10 === null ? [] : [s.cs10]), ...(mainRole === "TOP" || mainRole === "MIDDLE" ? [s.solo] : [])]);
  const axisScores: Record<AxisKey, number> = {
    laning,
    fighting: mean([s.kp, s.dmg, s.kda]),
    vision: s.vision * 0.7 + s.pinks * 0.3,
    survival: s.deaths * 0.6 + s.dead * 0.4,
    objective: s.obj * 0.6 + s.turrets * 0.4,
    consistency: s.disaster * 0.65 + s.focus * 0.35,
  };
  const axes: Axis[] = (Object.keys(AXIS_LABELS) as AxisKey[]).map((key) => ({
    key,
    label: AXIS_LABELS[key],
    score: Math.round(axisScores[key]),
  }));
  // 内容9割、勝敗1割。勝っていれば少しだけ甘くなる
  const overall = Math.round(mean(axes.map((a) => a.score)) * 0.9 + scale(winRate, [0.35, 0.65]) * 0.1);

  const top = champions[0];
  const enough = games >= 8;
  const strengths: Trait<StrengthId>[] = [];
  const weaknesses: Trait<WeaknessId>[] = [];
  const strong = (id: StrengthId, on: boolean, strength: number): void => {
    if (on) strengths.push({ id, strength: Math.min(1, Math.max(0.05, strength)) });
  };
  const weak = (id: WeaknessId, on: boolean, strength: number): void => {
    if (on) weaknesses.push({ id, strength: Math.min(1, Math.max(0.05, strength)) });
  };

  strong("kda", avg.kda >= 3.5, above(s.kda, 60));
  strong("cs", !support && s.cs >= 68, above(s.cs, 60));
  strong("vision", s.vision >= 68, above(s.vision, 60));
  strong("teamfight", s.kp >= 70, above(s.kp, 62));
  strong("damage", !support && s.dmg >= 70, above(s.dmg, 62));
  // 文章が「対面を倒す」なので、対面のいるレーナーだけ
  strong("solokill", !support && mainRole !== "JUNGLE" && avg.soloKills >= 1.2, above(s.solo, 55));
  strong("survive", avg.deathsPer30 <= 4.2, above(s.deaths, 70));
  strong("objective", axisScores.objective >= 70, above(axisScores.objective, 62));
  strong("onetrick", top.games >= 6 && top.games / games >= 0.5 && top.wins / top.games >= 0.5, top.games / games - 0.2);
  strong("winrate", enough && winRate >= 0.58, (winRate - 0.5) * 4);
  strong("firstblood", avg.firstBloodRate >= 0.3, avg.firstBloodRate);
  strong("pool", champions.length >= 7 && winRate >= 0.5, 0.3);
  strong("multikill", largestMultiKill >= 4, largestMultiKill >= 5 ? 0.9 : 0.5);

  const feeder = avg.deathsPer30 >= 7;
  weak("feeder", feeder, below(s.deaths, 35) + 0.4);
  // 「デスが多い」と同じ話になるので、デスの数は並なのに灰色の時間だけ長いときに限る
  weak("grayscreen", !feeder && avg.deadShare >= 0.14, below(s.dead, 40) + 0.2);
  weak("lowcs", !support && s.cs <= 35, below(s.cs, 35) + 0.3);
  weak("loselane", !support && s.cs10 !== null && s.cs10 <= 30 && s.cs > 35, below(s.cs10 ?? 0, 30) + 0.2);
  weak("blind", s.vision <= 35, below(s.vision, 35) + 0.3);
  weak("nopink", avg.controlWards < (support ? 2 : 0.8), 0.35);
  weak("afk", s.kp <= 30, below(s.kp, 30) + 0.3);
  weak("lowdamage", !support && s.dmg <= 30, below(s.dmg, 30) + 0.25);
  weak("kdaplayer", enough && avg.kda >= 3.5 && winRate < 0.47, 0.6 + (0.47 - winRate) * 2);
  weak("coinflip", disasterRate >= 0.3 && matches.filter((m) => kdaOf(m.kills, m.deaths, m.assists) >= 5).length / games >= 0.2, 0.5);
  weak("tourist", champions.length >= 8 && champions.length / games >= 0.45 && winRate < 0.5, 0.45);
  weak("losing", enough && winRate <= 0.42, 0.4 + (0.42 - winRate) * 3);
  weak("nomad", mainRole !== "UNKNOWN" && roleShare < 0.45, 0.4);
  weak("noobjective", axisScores.objective <= 30, below(axisScores.objective, 30) + 0.15);

  // --- くわしい解析から出る強み・弱み ---
  const { lane, deaths } = detail;
  const laner = mainRole === "TOP" || mainRole === "MIDDLE" || mainRole === "BOTTOM";
  const gold15 = lane.goldDiff15;
  const losses = games - wins;
  const recentRate = winRateOf(detail.recent);
  const earlierRate = winRateOf(detail.earlier);

  strong(
    "lanewin",
    lane.games >= 6 && ((lane.wonRate ?? 0) >= 0.62 || (gold15 ?? 0) >= 500),
    0.35 + Math.max((lane.wonRate ?? 0.5) - 0.5, (gold15 ?? 0) / 2500),
  );
  strong("comeback", detail.behind15.games >= 3 && detail.behind15.wins >= 2 && winRateOf(detail.behind15) >= 0.5, 0.45);
  strong("lategame", detail.length.long.games >= 4 && winRateOf(detail.length.long) >= 0.7, 0.35);
  strong("plates", laner && detail.plates >= 2, 0.3 + (detail.plates - 2) * 0.15);
  strong("healer", support && detail.healShieldPerMin >= 250, 0.3 + (detail.healShieldPerMin - 250) / 500);
  strong("cc", detail.ccSec >= 35, 0.25 + (detail.ccSec - 35) / 80);
  strong("dodger", detail.dodged >= 55, 0.2 + (detail.dodged - 55) / 100);
  strong("form", games >= 10 && detail.recent.wins >= 4 && recentRate > earlierRate, 0.4 + (recentRate - earlierRate) / 2);
  strong("steal", detail.steals >= 1, 0.3 + detail.steals * 0.1);

  weak("behind15", lane.games >= 6 && gold15 !== null && gold15 <= -500, 0.35 + -(gold15 ?? 0) / 2500);
  weak("earlydeath", deaths !== null && deaths.per10 >= 1.5, 0.35 + ((deaths?.per10 ?? 0) - 1.5) / 3);
  weak("deepdeath", deaths !== null && deaths.counted >= 20 && deaths.deep >= 0.45, 0.3 + ((deaths?.deep ?? 0) - 0.45));
  weak("solodeath", deaths !== null && deaths.counted >= 20 && deaths.solo >= 0.4, 0.3 + ((deaths?.solo ?? 0) - 0.4));
  weak("thrower", detail.ahead15.games >= 3 && winRateOf(detail.ahead15) <= 0.5, 0.45 + (0.5 - winRateOf(detail.ahead15)) / 2);
  weak("tilt", detail.afterLoss.games >= 4 && winRateOf(detail.afterLoss) <= 0.3, 0.5 + (0.3 - winRateOf(detail.afterLoss)));
  weak("marathon", detail.longestSession >= 6, 0.25 + (detail.longestSession - 6) * 0.08);
  weak("nightloss", detail.time.night.games >= 4 && winRateOf(detail.time.night) <= 0.35, 0.4);
  weak("ff", detail.surrenders >= 3 && detail.surrenders / Math.max(1, losses) >= 0.4, 0.35);
  weak("pinger", detail.missingPings >= 8, 0.3 + (detail.missingPings - 8) / 30);
  weak("slump", games >= 10 && detail.recent.wins <= 1 && earlierRate - recentRate >= 0.2, 0.45 + (earlierRate - recentRate) / 2);
  weak("sidegap", detail.weakSide !== null, 0.3);
  weak("latelose", detail.length.long.games >= 4 && winRateOf(detail.length.long) <= 0.3, 0.35);
  weak("badchamp", badChampion !== null, 0.4);

  strengths.sort((a, b) => b.strength - a.strength);
  weaknesses.sort((a, b) => b.strength - a.strength);

  // デスが同じなら新しい試合(matches は新しい順)
  const worstGame = matches.reduce((worst, m) => (m.deaths > worst.deaths ? m : worst), matches[0]);

  return {
    games,
    wins,
    winRate,
    mainRole,
    roleShare,
    champions,
    avg,
    axes,
    overall,
    grade: gradeOf(overall),
    strengths,
    weaknesses,
    worstGame,
    disasterRate,
    longestLosingStreak: longestLosingStreak(matches),
    largestMultiKill,
    detail,
    badChampion,
  };
}

/** よく使う3体の試合数の合計 */
function sum3(champions: readonly ChampionSummary[]): number {
  return champions.slice(0, 3).reduce((total, c) => total + c.games, 0);
}
