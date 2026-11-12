// サーバー(lol/server)と画面(lol/src)の両方が使う型。ここだけが両者の約束ごと。

export type Role = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY" | "UNKNOWN";

/** 1試合ぶんの、本人の成績だけを抜き出したもの。ほかの9人の情報は持たない。 */
export interface MatchStat {
  matchId: string;
  /** 420=ランク(ソロ/デュオ) 440=ランク(フレックス) 400/430/490=ノーマル */
  queueId: number;
  /** 試合開始時刻(エポックミリ秒) */
  gameStart: number;
  durationSec: number;
  win: boolean;
  role: Role;
  /** Data Dragon のチャンピオンID(例: "LeeSin") */
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  /** ミニオン+中立モンスター */
  cs: number;
  gold: number;
  /** チャンピオンへの与ダメージ */
  damage: number;
  damageTaken: number;
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  /** 買ったコントロールワードの数 */
  controlWards: number;
  /** 自分を含む味方5人の合計 */
  teamKills: number;
  teamDamage: number;
  /** ファーストブラッドに絡んだ(キルかアシスト) */
  firstBlood: boolean;
  soloKills: number;
  /** 10分時点のCS。取れない試合は null */
  csAt10: number | null;
  /** ドラゴン・バロン・ヘラルドに絡んだ数 */
  objectives: number;
  turretTakedowns: number;
  largestMultiKill: number;
  /** 死んで灰色の画面を見ていた秒数 */
  timeDeadSec: number;

  // --- ここから下は、くわしい解析用 ---
  /** 青側(teamId 100)か赤側(200)か */
  side: "blue" | "red";
  /** 試合終了時のチャンピオンレベル */
  level: number;
  /** 対面(相手チームの同じロール)との、試合終了時の差(自分 − 対面)。対面が決まらない試合は null */
  csDiff: number | null;
  goldDiff: number | null;
  damageDiff: number | null;
  /** レーン戦の終わり(約14分)でゴールドと経験値が対面より上だったか。分からなければ null */
  laneWon: boolean | null;
  /** 取ったタワープレートの数 */
  turretPlates: number;
  /** ドラゴン・バロンなどオブジェクトへのダメージ */
  objectiveDamage: number;
  /** 味方チームが取ったドラゴン・バロン・ヘラルドの合計(objectives と比べて関与の割合を出す) */
  teamObjectives: number;
  /** 味方への回復とシールドの合計 */
  healShield: number;
  /** 相手に行動妨害(CC)をかけていた秒数 */
  ccSec: number;
  /** 避けたスキルショットの数 */
  skillshotsDodged: number;
  /** 相手から奪ったドラゴン・バロンなどの数 */
  epicSteals: number;
  /** 出したピンの合計 */
  pings: number;
  /** そのうち「?」(敵が消えた)ピンの数 */
  missingPings: number;
  /** 降参で終わった負け試合か */
  surrendered: boolean;
  /** いちばん長く生きていた秒数 */
  longestLivingSec: number;
  /** タイムライン(1分ごとの記録と出来事)から取った値。取れなかった試合は null */
  timeline: MatchTimeline | null;
}

/** 1試合のタイムラインから、本人のぶんだけ抜き出したもの */
export interface MatchTimeline {
  /** 10分・15分時点の、対面とのゴールド差(自分 − 対面)。試合がそこまで続かなかった、対面が決まらないときは null */
  goldDiff10: number | null;
  goldDiff15: number | null;
  /** 10分時点の、対面とのCS差 */
  csDiff10: number | null;
  /** 10分までのキル+アシスト */
  takedowns10: number;
  /** 死んだ時刻(分。小数1桁)。時刻順 */
  deathMinutes: number[];
  /** 相手1人にやられたデス(アシストなし)の数 */
  soloDeaths: number;
  /** 相手側の陣地で死んだデスの数 */
  deepDeaths: number;
}

export interface RankInfo {
  /** "IRON" 〜 "CHALLENGER" */
  tier: string;
  /** "I" 〜 "IV"(マスター以上は "I") */
  division: string;
  lp: number;
  wins: number;
  losses: number;
}

export interface PlayerData {
  gameName: string;
  tagLine: string;
  level: number | null;
  /** ソロ/デュオのランク。未判定なら null */
  rank: RankInfo | null;
  /** 新しい順。リメイクとサモナーズリフト以外(ARAMなど)は入れない */
  matches: MatchStat[];
  /** 内蔵のサンプル(架空のプレイヤー)なら true */
  sample?: boolean;
}

/** GET /api/player が失敗したときの本文 */
export interface ApiError {
  /** no-key=APIキー未設定 not-found=Riot IDが見つからない no-matches=対象の試合がない rate-limit=混雑 bad-key=キーが無効・期限切れ */
  error: "no-key" | "not-found" | "no-matches" | "rate-limit" | "bad-key" | "bad-request" | "upstream";
  message: string;
}
