// 解析結果から「俺はこういうプレイができるぜ」の自己紹介を作る。DOMには触れない。
// 強みが3つに足りないときは、弱みを強気に言い換えて埋める(あとで評価役に崩される前フリ)。
import type { Analysis, StrengthId, WeaknessId } from "./analyze";
import { CRITIC_CALL, ROLE_LABELS, f1, hashString, makeRng, pct, pick, rankLabel } from "./labels";
import type { PhraseBook } from "./phrases";
import type { PlayerData } from "./types";

export type Topic = StrengthId | WeaknessId | "spirit";

export interface Claim {
  topic: Topic;
  /** 数字の裏づけがある強みなら true。弱みの言い換えや気合いだけなら false */
  backed: boolean;
  text: string;
}

export interface Intro {
  greeting: string;
  claims: Claim[];
  closing: string;
}

export interface TextOptions {
  /** 「言い直してもらう」のたびに変える数。同じ数なら同じ文章になる */
  variant?: number;
  /** チャンピオンIDを表示名にする(日本語名が取れていればそれを返す) */
  champName?: (id: string) => string;
  /** 評価役の口ぐせ。評価文(review)の前後に差し込む。自己紹介には使わない */
  phrases?: PhraseBook;
}

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
}

export function valuesOf(player: PlayerData, a: Analysis, champName: (id: string) => string): Values {
  const top = a.champions[0];
  const cs10 = a.avg.csAt10 ?? 0;
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
  };
}

export type Line = (v: Values) => string;

const BOASTS: Record<StrengthId, readonly Line[]> = {
  kda: [
    (v) => `KDAは${v.kda}。死なずに勝負に絡む、これが俺のLoLです。`,
    (v) => `平均${v.k}/${v.d}/${v.a}、KDA${v.kda}。数字が俺の実力を語ってます。`,
  ],
  cs: [
    (v) => `CSは分間${v.cs}。ファームの精度なら誰にも負けません。`,
    (v) => `分間${v.cs}CS。ミニオン1体たりとも無駄にしない男です。`,
  ],
  vision: [
    (v) => `視界スコアは分間${v.vision}。マップを照らすのは俺の仕事です。`,
    (v) => `コントロールワードは1試合${v.pinks}本。視界で試合を作るタイプです。`,
  ],
  teamfight: [
    (v) => `キル関与率${v.kp}%。戦いが起きる場所には必ず俺がいます。`,
    (v) => `チームのキルの${v.kp}%に絡んでます。俺抜きで集団戦は始まりません。`,
  ],
  damage: [
    (v) => `チームのダメージの${v.dmg}%は俺が出してます。キャリーは任せてください。`,
    (v) => `ダメージ割合${v.dmg}%。俺が殴らないと誰も倒れません。`,
  ],
  solokill: [
    (v) => `ソロキルは1試合平均${v.solo}回。対面は基本、壊します。`,
    (v) => `1試合に${v.solo}回は対面を1人で倒してます。1対1なら負けません。`,
  ],
  survive: [
    (v) => `デスは30分あたり${v.d30}回。死なないことにかけては自信があります。`,
    (v) => `30分やって${v.d30}デス。俺を倒すのは高くつきますよ。`,
  ],
  objective: [
    (v) => `ドラゴンにもバロンにも必ずいます。1試合で${v.obj}個のオブジェクトに絡んでます。`,
    (v) => `オブジェクト関与は1試合${v.obj}個。勝ち方を知ってる男です。`,
  ],
  onetrick: [
    (v) => `${v.champ}を${v.champGames}試合使って勝率${v.champWr}%。${v.champ}なら誰にも負けません。`,
    (v) => `直近${v.games}試合のうち${v.champGames}試合が${v.champ}。この1体を極めてます。`,
  ],
  winrate: [
    (v) => `直近${v.games}試合で勝率${v.wr}%。俺がいるチームは勝ちます。`,
    (v) => `勝率${v.wr}%。結果で語るタイプです。`,
  ],
  firstblood: [
    (v) => `ファーストブラッド関与率${v.fb}%。試合は俺が動かします。`,
    (v) => `${v.fb}%の試合で最初のキルに絡んでます。序盤から主導権を握ります。`,
  ],
  pool: [
    (v) => `直近だけで${v.pool}体のチャンピオンを使って勝ち越してます。何を出されても対応できます。`,
  ],
  multikill: [
    (v) => `最近${v.multi}も出ました。持ってる男です。`,
    (v) => `直近の試合で${v.multi}。集団戦は俺の見せ場です。`,
  ],
};

/** 弱みを強気に言い換えた自己紹介 */
const SPINS: Record<WeaknessId | "spirit", readonly Line[]> = {
  feeder: [
    (v) => `デスは1試合${v.d}回ですが、それだけ前で戦ってるってことです。アグレッシブさが売りです。`,
    () => `よく死にますが、相手の注意を引きつける役を買って出てるんです。`,
  ],
  grayscreen: [() => `灰色の画面の時間は長めですが、そのあいだに次の動きを考えてます。`],
  lowcs: [
    (v) => `CSは分間${v.cs}ですが、俺はミニオンよりキルを見てるんで。`,
    (v) => `CSは分間${v.cs}。ファームより戦闘、それが俺のスタイルです。`,
  ],
  loselane: [(v) => `10分時点のCSは${v.cs10}ですが、レーン戦は準備運動だと思ってます。本番は中盤からです。`],
  blind: [
    () => `ワードはあまり置きませんが、マップは勘で見えてます。`,
    (v) => `視界スコアは分間${v.vision}ですが、視界に頼らない立ち回りができます。`,
  ],
  nopink: [() => `コントロールワードは買いません。その75ゴールドで強くなるほうが早いので。`],
  afk: [
    () => `集団戦にはあまり行きませんが、サイドで圧をかけるのが俺の仕事です。`,
    (v) => `キル関与率は${v.kp}%ですが、1人でレーンを押し続けるのも立派な戦術です。`,
  ],
  lowdamage: [() => `ダメージは控えめですが、数字に出ない貢献をしてます。`],
  kdaplayer: [(v) => `勝率は${v.wr}%ですが、KDAは${v.kda}。俺は仕事をしてます。`],
  coinflip: [() => `ハマった試合の俺は誰にも止められません。波があるのは才能の証拠です。`],
  tourist: [(v) => `${v.pool}体使えます。何でもできるのが俺の強みです。`],
  losing: [
    (v) => `勝率は${v.wr}%ですが、内容はいいはずです。味方に恵まれてないだけで。`,
    (v) => `勝率${v.wr}%は仮の姿です。本当の実力はこんなものじゃありません。`,
  ],
  nomad: [() => `ロールは決めてません。全部できるので。`],
  noobjective: [() => `オブジェクトにはあまり寄りませんが、そのぶんレーンを押してます。`],
  spirit: [
    () => `やる気だけは誰にも負けません。`,
    () => `伸びしろはサーバーでいちばんだと思ってます。`,
    () => `メンタルは強いです。何連敗してもキューを押せます。`,
  ],
};

const GREETINGS: readonly Line[] = [
  (v) => `${CRITIC_CALL}、はじめまして! ${v.name}です。${v.rank}で${v.role}をやってます。`,
  (v) => `${CRITIC_CALL}、どうも。${v.name}です。メインは${v.role}、いちばん使うのは${v.champ}です。`,
  (v) => `${CRITIC_CALL}、聞いてください。${v.name}、${v.rank}の${v.role}です。`,
];

const CLOSINGS: readonly string[] = [
  "以上です。評価、お願いします!",
  "こんな俺ですが、どうですか!",
  "正直、かなりやれるほうだと思ってます。どうでしょう!",
];

/** 自己紹介で言うことの数 */
export const CLAIM_COUNT = 3;

export function seedOf(player: PlayerData, variant = 0): number {
  return hashString(`${player.gameName}#${player.tagLine}`.toLowerCase()) + variant * 7919;
}

export function buildIntro(player: PlayerData, analysis: Analysis, options: TextOptions = {}): Intro {
  const rng = makeRng(seedOf(player, options.variant));
  const v = valuesOf(player, analysis, options.champName ?? ((id) => id));

  const claims: Claim[] = analysis.strengths
    .slice(0, CLAIM_COUNT)
    .map((t) => ({ topic: t.id, backed: true, text: pick(BOASTS[t.id], rng)(v) }));
  // 足りないぶんは、目立つ弱みから順に言い換える。「KDAは高いのに勝てない」は強みの側で話に出るので使わない
  for (const w of analysis.weaknesses) {
    if (claims.length >= CLAIM_COUNT) break;
    if (w.id === "kdaplayer" && claims.some((c) => c.topic === "kda")) continue;
    claims.push({ topic: w.id, backed: false, text: pick(SPINS[w.id], rng)(v) });
  }
  const spirits = [...SPINS.spirit];
  while (claims.length < CLAIM_COUNT && spirits.length > 0) {
    const line = spirits.splice(Math.floor(rng() * spirits.length), 1)[0];
    claims.push({ topic: "spirit", backed: false, text: line(v) });
  }

  return { greeting: pick(GREETINGS, rng)(v), claims, closing: pick(CLOSINGS, rng) };
}
