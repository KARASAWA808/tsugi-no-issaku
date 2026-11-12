// 解析結果から「俺はこういうプレイができるぜ」の自己紹介を作る。DOMには触れない。
// 強みが3つに足りないときは、弱みを強気に言い換えて埋める(あとで評価役に崩される前フリ)。
import type { Analysis, StrengthId, WeaknessId } from "./analyze";
import { choose, hashString, makeRng, pick } from "./labels";
import type { PhraseBook } from "./phrases";
import { BOASTS, CLOSINGS, GREETINGS, SPINS } from "./text/intro-lines";
import { valuesOf } from "./text/values";
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

export { type Line, type Values, valuesOf } from "./text/values";

/** 自己紹介で言うことの数 */
export const CLAIM_COUNT = 3;

export function seedOf(player: PlayerData, variant = 0): number {
  return hashString(`${player.gameName}#${player.tagLine}`.toLowerCase()) + variant * 7919;
}

export function buildIntro(player: PlayerData, analysis: Analysis, options: TextOptions = {}): Intro {
  const rng = makeRng(seedOf(player, options.variant));
  const v = valuesOf(player, analysis, options.champName ?? ((id) => id));

  const variant = options.variant ?? 0;
  // 最初はいちばん目立つ強みを言う。言い直すたびに、ほかの強みも混ざる
  const claims: Claim[] = choose(analysis.strengths, CLAIM_COUNT, rng, variant).map((t) => ({
    topic: t.id,
    backed: true,
    text: pick(BOASTS[t.id], rng)(v),
  }));
  // 足りないぶんは、弱みを言い換えて埋める。「KDAは高いのに勝てない」は強みの側で話に出るので使わない
  const spinnable = analysis.weaknesses.filter((w) => !(w.id === "kdaplayer" && claims.some((c) => c.topic === "kda")));
  for (const w of choose(spinnable, CLAIM_COUNT - claims.length, rng, variant)) {
    claims.push({ topic: w.id, backed: false, text: pick(SPINS[w.id], rng)(v) });
  }
  const spirits = [...SPINS.spirit];
  while (claims.length < CLAIM_COUNT && spirits.length > 0) {
    const line = spirits.splice(Math.floor(rng() * spirits.length), 1)[0];
    claims.push({ topic: "spirit", backed: false, text: line(v) });
  }

  return { greeting: pick(GREETINGS, rng)(v), claims, closing: pick(CLOSINGS, rng) };
}
