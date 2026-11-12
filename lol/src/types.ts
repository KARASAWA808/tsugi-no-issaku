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
