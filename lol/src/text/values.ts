// 文章に差し込む数字を、解析結果から整形して用意する。DOMには触れない。
import type { Analysis } from "../analyze";
import { winRateOf } from "../detail";
import { ROLE_LABELS, f1, pct, rankLabel } from "../labels";
import type { MatchStat, PlayerData } from "../types";

/** 文章に差し込む、整形ずみの数字 */
export interface Values {
  name: string;
  rank: string;
  role: string;
  games: string;
  wr: string;
  champ: string;
  champGames: string;
  champWr: string;
  pool: string;
  kda: string;
  k: string;
  d: string;
  a: string;
  cs: string;
  cs10: string;
  /** 10分CSの当面の目標(いまの値+10、5刻み) */
  cs10Goal: string;
  vision: string;
  pinks: string;
  kp: string;
  dmg: string;
  solo: string;
  d30: string;
  dead: string;
  fb: string;
  obj: string;
  disaster: string;
  streak: string;
  worstD: string;
  worstChamp: string;
  multi: string;
  overall: string;

  // --- くわしい解析から。数字が取れないときは "0" や "—" が入るので、その話題の文でだけ使う ---
  /** レーン戦で対面より上だった試合の割合(%) */
  lanePct: string;
  /** 15分時点の対面とのゴールド差の大きさ(符号なし、10刻み)。勝っているか負けているかは話題で決まる */
  gd15: string;
  /** 10分時点の対面とのCS差の大きさ(符号なし) */
  cd10: string;
  /** 10分までのキル+アシスト(1試合あたり) */
  tk10: string;
  /** 10分までのデス(1試合あたり) */
  d10: string;
  /** デスのうち、10分までのもの / 相手陣地でのもの / 相手1人にやられたものの割合(%) */
  earlyPct: string;
  deepPct: string;
  soloPct: string;
  /** 15分で1000ゴールド以上リードした試合の数と、そのうち負けた数 */
  aheadGames: string;
  aheadLosses: string;
  /** 15分で1000ゴールド以上負けていた試合の数と、そのうち勝った数 */
  behindGames: string;
  behindWins: string;
  /** 負けた直後(20分以内)に始めた試合の数・勝率(%)・負け数 */
  afterLossGames: string;
  afterLossWr: string;
  afterLossLosses: string;
  /** 休みなく続けた最多の試合数 */
  session: string;
  /** 深夜(0〜5時)に始めた試合の数と勝率(%) */
  nightGames: string;
  nightWr: string;
  /** 降参で終わった負け試合の数 */
  ffCount: string;
  /** 1試合あたりの「?」ピンの数 / ピン全体の数 */
  pingQ: string;
  pingAll: string;
  /** 直近5試合の勝ち数・負け数と、それより前の勝率(%) */
  recentW: string;
  recentL: string;
  earlierWr: string;
  /** 苦手な側("青側" / "赤側")とその勝率(%)、得意な側とその勝率(%) */
  weakSide: string;
  weakSideWr: string;
  strongSide: string;
  strongSideWr: string;
  /** 35分以上の試合の数と勝率(%) */
  longGames: string;
  longWr: string;
  /** 勝てていないチャンピオンの名前・試合数・勝率(%)・負け数 */
  badChamp: string;
  badChampGames: string;
  badChampWr: string;
  badChampLosses: string;
  /** 1試合あたりのタワープレート / CCをかけた秒数 / 避けたスキルショット */
  plates: string;
  cc: string;
  dodged: string;
  /** 1分あたりの、味方への回復+シールド */
  heal: string;
  /** 奪ったドラゴン・バロンの合計 */
  steals: string;
  /** 味方のドラゴン・バロンのうち、自分が絡んだ割合(%) */
  objShare: string;
  /** いちばん出来の良かった試合のチャンピオン・"12/2/9" の形のKDA・出来の点数 */
  bestChamp: string;
  bestKda: string;
  bestScore: string;
  /** いちばんデスの多かった試合のKDA("1/16/3" の形) */
  worstKda: string;

  // --- どの話題でも使える、追加の数字 ---
  /** 勝ち数・負け数 */
  wins: string;
  losses: string;
  /** メインロールの試合の割合(%) */
  rolePct: string;
  /** 負けのうち、降参で終わった割合(%) */
  ffPct: string;
  /** 大活躍した試合(KDAが5以上)の割合(%) */
  greatPct: string;
  /** デスのうち、25分以降のものの割合(%) */
  latePct: string;
  /** 深夜(0〜5時)以外に始めた試合の勝率(%)。そういう試合が無ければ全体の勝率 */
  dayWr: string;
  /** 勝った直後(20分以内)に始めた試合の勝率(%)。そういう試合が無ければ全体の勝率 */
  afterWinWr: string;
  /** いちばん使うチャンピオン以外での勝率(%)。1体しか使っていなければ全体の勝率 */
  otherWr: string;
  /** 1試合の平均の長さ(分) */
  avgMin: string;
  /** 青側・赤側それぞれの勝率(%) */
  blueWr: string;
  redWr: string;
}

export function valuesOf(player: PlayerData, a: Analysis, champName: (id: string) => string): Values {
  const top = a.champions[0];
  const cs10 = a.avg.csAt10 ?? 0;
  const d = a.detail;
  const abs10 = (n: number | null): string => String(Math.round(Math.abs(n ?? 0) / 10) * 10);
  const kdaText = (m: MatchStat): string => `${m.kills}/${m.deaths}/${m.assists}`;
  const sideName = (side: "blue" | "red"): string => (side === "blue" ? "青側" : "赤側");
  const weak = d.weakSide ?? "red";
  const strong = weak === "blue" ? "red" : "blue";
  const bad = a.badChampion;
  const ratio = (n: number, of: number): number => (of > 0 ? n / of : 0);
  return {
    name: player.gameName,
    rank: rankLabel(player.rank),
    role: ROLE_LABELS[a.mainRole],
    games: String(a.games),
    wr: pct(a.winRate),
    champ: champName(top.champion),
    champGames: String(top.games),
    champWr: pct(top.wins / top.games),
    pool: String(a.champions.length),
    kda: f1(a.avg.kda),
    k: f1(a.avg.kills),
    d: f1(a.avg.deaths),
    a: f1(a.avg.assists),
    cs: f1(a.avg.csPerMin),
    cs10: String(Math.round(cs10)),
    cs10Goal: String(Math.ceil((cs10 + 10) / 5) * 5),
    vision: f1(a.avg.visionPerMin),
    pinks: f1(a.avg.controlWards),
    kp: pct(a.avg.killParticipation),
    dmg: pct(a.avg.damageShare),
    solo: f1(a.avg.soloKills),
    d30: f1(a.avg.deathsPer30),
    dead: pct(a.avg.deadShare),
    fb: pct(a.avg.firstBloodRate),
    obj: f1(a.avg.objectives),
    disaster: pct(a.disasterRate),
    streak: String(a.longestLosingStreak),
    worstD: String(a.worstGame.deaths),
    worstChamp: champName(a.worstGame.champion),
    multi: a.largestMultiKill >= 5 ? "ペンタキル" : "クアドラキル",
    overall: String(a.overall),

    lanePct: pct(d.lane.wonRate ?? 0),
    gd15: abs10(d.lane.goldDiff15),
    cd10: String(Math.round(Math.abs(d.lane.csDiff10 ?? 0))),
    tk10: f1(d.lane.takedowns10 ?? 0),
    d10: f1(d.deaths?.per10 ?? 0),
    earlyPct: pct(d.deaths?.early ?? 0),
    deepPct: pct(d.deaths?.deep ?? 0),
    soloPct: pct(d.deaths?.solo ?? 0),
    aheadGames: String(d.ahead15.games),
    aheadLosses: String(d.ahead15.games - d.ahead15.wins),
    behindGames: String(d.behind15.games),
    behindWins: String(d.behind15.wins),
    afterLossGames: String(d.afterLoss.games),
    afterLossWr: pct(winRateOf(d.afterLoss)),
    afterLossLosses: String(d.afterLoss.games - d.afterLoss.wins),
    session: String(d.longestSession),
    nightGames: String(d.time.night.games),
    nightWr: pct(winRateOf(d.time.night)),
    ffCount: String(d.surrenders),
    pingQ: String(Math.round(d.missingPings)),
    pingAll: String(Math.round(d.pings)),
    recentW: String(d.recent.wins),
    recentL: String(d.recent.games - d.recent.wins),
    earlierWr: pct(winRateOf(d.earlier)),
    weakSide: sideName(weak),
    weakSideWr: pct(winRateOf(d.side[weak])),
    strongSide: sideName(strong),
    strongSideWr: pct(winRateOf(d.side[strong])),
    longGames: String(d.length.long.games),
    longWr: pct(winRateOf(d.length.long)),
    badChamp: bad ? champName(bad.champion) : "—",
    badChampGames: String(bad?.games ?? 0),
    badChampWr: pct(bad ? bad.wins / bad.games : 0),
    badChampLosses: String(bad ? bad.games - bad.wins : 0),
    plates: f1(d.plates),
    cc: String(Math.round(d.ccSec)),
    dodged: String(Math.round(d.dodged)),
    heal: String(Math.round(d.healShieldPerMin / 10) * 10),
    steals: String(d.steals),
    objShare: pct(d.objectiveShare),
    bestChamp: champName(d.bestGame.champion),
    bestKda: kdaText(d.bestGame),
    bestScore: String(Math.max(...d.scores)),
    worstKda: kdaText(a.worstGame),

    wins: String(a.wins),
    losses: String(a.games - a.wins),
    rolePct: pct(a.roleShare),
    ffPct: pct(a.games - a.wins > 0 ? d.surrenders / (a.games - a.wins) : 0),
    greatPct: pct(player.matches.filter((m) => (m.kills + m.assists) / Math.max(1, m.deaths) >= 5).length / a.games),
    latePct: pct(d.deaths?.late ?? 0),
    // 当てはまる試合が1つも無いときは、全体の勝率で代える(「0%」と出て話がおかしくならないように)
    dayWr: pct(a.games - d.time.night.games > 0 ? ratio(a.wins - d.time.night.wins, a.games - d.time.night.games) : a.winRate),
    afterWinWr: pct(d.afterWin.games > 0 ? winRateOf(d.afterWin) : a.winRate),
    otherWr: pct(a.games - top.games > 0 ? ratio(a.wins - top.wins, a.games - top.games) : a.winRate),
    avgMin: String(Math.round(a.avg.durationMin)),
    blueWr: pct(winRateOf(d.side.blue)),
    redWr: pct(winRateOf(d.side.red)),
  };
}

export type Line = (v: Values) => string;
