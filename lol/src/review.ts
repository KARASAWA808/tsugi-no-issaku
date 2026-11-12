// 自己紹介のひとつひとつに、評価役(架空のキャラクター)が数字でツッコミを入れる。DOMには触れない。
// 辛口にするのはプレイの内容だけ。人格・容姿・属性には触れない文章だけを置く。
import type { Analysis, AxisKey, Grade, StrengthId, WeaknessId } from "./analyze";
import { type Intro, type TextOptions, type Topic, seedOf, valuesOf } from "./intro";
import { choose, makeRng, pick } from "./labels";
import { emptyBook, makeSpeaker } from "./phrases";
import { ACKS, BUTS, DEBUNKS } from "./text/reply-lines";
import { CLEAN_TITLES, HIGHLIGHTS, HOMEWORK, NO_HOMEWORK, OPENINGS, ROASTS, TITLES, VERDICTS } from "./text/verdict-lines";
import type { PlayerData } from "./types";

export interface Reply {
  topic: Topic;
  /** 強みとして認めたなら true、崩したなら false */
  accepted: boolean;
  text: string;
}

export interface Roast {
  topic: WeaknessId | AxisKey;
  text: string;
}

export interface Review {
  opening: string;
  /** intro.claims と同じ順番・同じ数 */
  replies: Reply[];
  /** 自己紹介で触れなかった弱み */
  roasts: Roast[];
  grade: Grade;
  /** いちばん出来の良かった試合へのひとこと */
  highlight: string;
  /** ひとことで言うとどんなプレイヤーか */
  title: string;
  verdict: string;
  /** 次にやること。辛口でも、ここだけは具体的な助言にする */
  homework: string;
}


/** 「触れなかった弱み」として挙げる数の上限 */
const ROAST_LIMIT = 3;

export function buildReview(player: PlayerData, analysis: Analysis, intro: Intro, options: TextOptions = {}): Review {
  // 自己紹介と同じ種だと同じ番号の文を引きやすいので、ずらしておく
  const rng = makeRng(seedOf(player, options.variant) ^ 0x5bd1e995);
  const v = valuesOf(player, analysis, options.champName ?? ((id) => id));
  // 口ぐせは別の乱数で選ぶ。口ぐせを足しても、元の評価文の選ばれ方は変わらない
  const say = makeSpeaker(options.phrases ?? emptyBook(), makeRng(seedOf(player, options.variant) ^ 0x2c1b3c6d), player.gameName, analysis.mainRole, analysis.grade);
  const weak = new Set(analysis.weaknesses.map((w) => w.id));
  const mentioned = new Set<WeaknessId>();

  const replies: Reply[] = intro.claims.map((claim) => {
    if (!claim.backed) {
      const topic = claim.topic as WeaknessId | "spirit";
      if (topic !== "spirit") mentioned.add(topic);
      return { topic: claim.topic, accepted: false, text: say("reject", pick(DEBUNKS[topic], rng)(v), topic) };
    }
    const topic = claim.topic as StrengthId;
    // 最初はいちばん筋の通る組(表の上にあるもの)。言い直すと、当てはまる組のどれか
    const fitting = BUTS.filter((b) => b.strength === topic && weak.has(b.weakness) && !mentioned.has(b.weakness));
    const but = fitting.length === 0 ? undefined : (options.variant ?? 0) === 0 ? fitting[0] : pick(fitting, rng);
    if (but) mentioned.add(but.weakness);
    const ack = pick(ACKS[topic], rng)(v);
    return { topic, accepted: true, text: say("accept", but ? `${ack}${but.line(v)}` : ack, topic) };
  });

  const variant = options.variant ?? 0;
  const untouched = analysis.weaknesses.filter((w) => !mentioned.has(w.id));
  const roasts: Roast[] = choose(untouched, ROAST_LIMIT, rng, variant).map((w) => ({
    topic: w.id,
    text: say("roast", pick(ROASTS[w.id], rng)(v), w.id),
  }));
  // 弱みがひとつも出ていない人にも、いちばん低い軸をひとつだけ指摘する
  if (analysis.weaknesses.length === 0) {
    const lowest = analysis.axes.reduce((low, a) => (a.score < low.score ? a : low));
    roasts.push({
      topic: lowest.key,
      // 弱みではない軽い指摘なので、きつい口ぐせは付けない
      text: `強いて言うなら、${lowest.label}が${lowest.score}点でいちばん低い。伸ばすならここ。`,
    });
  }

  // 称号と宿題のもとにする弱み。最初はいちばん目立つもの、言い直すと上位3つのどれか
  const worst = choose(analysis.weaknesses.slice(0, 3), 1, rng, variant).at(0);
  const few = analysis.games < 8 ? `ただ${v.games}試合しかないから、話半分で聞いて。` : "";
  const high = analysis.grade === "S" || analysis.grade === "A";
  return {
    opening: say("opening", `${pick(OPENINGS, rng)(v)}${few}`),
    replies,
    roasts,
    grade: analysis.grade,
    highlight: pick(HIGHLIGHTS, rng)(v),
    title: pick(worst ? TITLES[worst.id] : CLEAN_TITLES[analysis.grade], rng),
    verdict: say(high ? "verdictHigh" : "verdictLow", pick(VERDICTS[analysis.grade], rng)(v), worst?.id),
    homework: say(
      "homework",
      worst ? pick(HOMEWORK[worst.id], rng)(v) : pick(NO_HOMEWORK, rng)(v),
      worst?.id,
    ),
  };
}
