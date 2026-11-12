// 自己紹介のひとつひとつに、評価役(架空のキャラクター)が数字でツッコミを入れる。DOMには触れない。
// 辛口にするのはプレイの内容だけ。人格・容姿・属性には触れない文章だけを置く。
import type { Analysis, AxisKey, Grade, StrengthId, WeaknessId } from "./analyze";
import { type Intro, type TextOptions, type Topic, seedOf, valuesOf } from "./intro";
import { choose, makeRng, pick } from "./labels";
import { emptyBook, makeSpeaker } from "./phrases";
import { ACKS, BUTS, DEBUNKS } from "./text/reply-lines";
import { NOTES, TITLE_PREFIXES } from "./text/note-lines";
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
  /** 脱線。評価とは関係なく挟まる独立したひとこと(雑談、長い台詞、使っているチャンピオンの話)。口ぐせが無ければ空 */
  asides: string[];
  grade: Grade;
  /** 自己紹介の「いちばん良かった試合」の自慢への返事 */
  highlight: string;
  /** 「ところで」のひとこと。強みや弱みと言うほどではない、目に付いた数字に触れる */
  note: string;
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
  const say = makeSpeaker(options.phrases ?? emptyBook(), makeRng(seedOf(player, options.variant) ^ 0x2c1b3c6d), player.gameName, analysis.mainRole, analysis.grade, new Set(analysis.champions.map((c) => c.champion)));
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
  // 脱線は2つまで。1つ目は使っているチャンピオンやいちばんの弱みに合うもの、2つ目はただの雑談
  // 雑談のほうは、チャンピオンの話に出番を取られないよう、チャンピオンを知らない別の話し手に選ばせる
  const chat = makeSpeaker(options.phrases ?? emptyBook(), makeRng(seedOf(player, options.variant) ^ 0x7f4a7c15), player.gameName, analysis.mainRole, analysis.grade);
  const asides = [...new Set([say("aside", "", worst?.id), chat("aside", "")])].filter((text) => text !== "");
  // 「ところで」と称号の枕ことばは、別の乱数で選ぶ(足しても、ほかの文の選ばれ方は変わらない)
  const extra = makeRng(seedOf(player, options.variant) ^ 0x3c6ef372);
  const traits = new Set<string>([...analysis.strengths, ...analysis.weaknesses].map((t) => t.id));
  const fitting = NOTES.filter((n) => n.when(analysis, (id) => traits.has(id)));
  // 誰にでも当てはまるもの(最後の1つ)は、ほかに無いときと、たまに選ぶ
  const specific = fitting.slice(0, -1);
  const note = pick(pick(specific.length > 0 && extra() < 0.85 ? specific : fitting.slice(-1), extra).lines, extra)(v);
  // 称号の枕ことばは、半分くらいの確率で付く(弱みから付いた称号にだけ)。同じ弱みの人どうしで称号がそろいにくくなる
  const prefix = worst && extra() < 0.5 ? pick(TITLE_PREFIXES, extra) : "";
  const few = analysis.games < 8 ? `ただ${v.games}試合しかないから、話半分で聞いて。` : "";
  const high = analysis.grade === "S" || analysis.grade === "A";
  return {
    opening: say("opening", `${pick(OPENINGS, rng)(v)}${few}`),
    replies,
    roasts,
    asides,
    grade: analysis.grade,
    highlight: pick(HIGHLIGHTS, rng)(v),
    note,
    title: `${prefix}${pick(worst ? TITLES[worst.id] : CLEAN_TITLES[analysis.grade], rng)}`,
    verdict: say(high ? "verdictHigh" : "verdictLow", pick(VERDICTS[analysis.grade], rng)(v), worst?.id),
    homework: say(
      "homework",
      worst ? pick(HOMEWORK[worst.id], rng)(v) : pick(NO_HOMEWORK, rng)(v),
      worst?.id,
    ),
  };
}
