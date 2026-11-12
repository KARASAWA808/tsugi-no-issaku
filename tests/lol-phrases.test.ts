import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { buildIntro } from "../lol/src/intro";
import { makeRng } from "../lol/src/labels";
import { BUILTIN_PHRASES, type PhraseBook, SLOTS, countPhrases, emptyBook, makeSpeaker, mergePhrases, parsePhrases } from "../lol/src/phrases";
import { buildReview } from "../lol/src/review";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";

const book = (over: Partial<PhraseBook>): PhraseBook => ({ ...emptyBook(), ...over });

function review(id: string, phrases?: PhraseBook, variant = 0) {
  const player = samplePlayer(id)!;
  const analysis = analyze(player)!;
  const intro = buildIntro(player, analysis, { variant });
  return buildReview(player, analysis, intro, { variant, phrases });
}

describe("parsePhrases", () => {
  it("文字列と { text, after } の両方を読む", () => {
    const parsed = parsePhrases({ accept: ["いいね", { text: "だよね", after: true }] });
    expect(parsed.accept).toEqual([{ text: "いいね" }, { text: "だよね", after: true }]);
    expect(parsed.reject).toEqual([]);
  });

  it("形の合わないものは捨てる(壊れたファイルでも落ちない)", () => {
    for (const broken of [null, 3, "x", [], { accept: "ひとつだけ" }, { accept: [1, null, {}, { text: 5 }, "", "   "] }]) {
      expect(countPhrases(parsePhrases(broken))).toBe(0);
    }
  });

  it("知らない場所の名前は無視する", () => {
    expect(countPhrases(parsePhrases({ somewhere: ["あ"], opening: ["い"] }))).toBe(1);
  });

  it("長すぎる言い回しと、多すぎるぶんは入れない", () => {
    expect(parsePhrases({ roast: ["あ".repeat(81), "い".repeat(80)] }).roast).toHaveLength(1);
    expect(parsePhrases({ roast: Array.from({ length: 200 }, (_, i) => `口ぐせ${i}`) }).roast).toHaveLength(60);
  });

  it("前後の空白は落とす", () => {
    expect(parsePhrases({ opening: ["  はい  "] }).opening).toEqual([{ text: "はい" }]);
  });
});

describe("mergePhrases", () => {
  it("場所ごとに合わせ、同じ言い回しは1つにする", () => {
    const merged = mergePhrases(book({ accept: [{ text: "いいね" }] }), book({ accept: [{ text: "いいね" }, { text: "えらい" }], roast: [{ text: "あと" }] }));
    expect(merged.accept.map((p) => p.text)).toEqual(["いいね", "えらい"]);
    expect(merged.roast).toEqual([{ text: "あと" }]);
  });
});

describe("makeSpeaker", () => {
  it("口ぐせがなければ、評価文をそのまま返す", () => {
    expect(makeSpeaker(emptyBook(), makeRng(1), "テスト")("accept", "本文。")).toBe("本文。");
  });

  it("前に付けるときは、文の切れ目がなければ句点を足す", () => {
    const say = makeSpeaker(book({ accept: [{ text: "いいね" }], reject: [{ text: "いや、" }] }), makeRng(1), "テスト");
    expect(say("accept", "本文。")).toBe("いいね。本文。");
    expect(say("reject", "本文。")).toBe("いや、本文。");
  });

  it("after なら後ろに付ける", () => {
    expect(makeSpeaker(book({ roast: [{ text: "知らんけど。", after: true }] }), makeRng(1), "テスト")("roast", "本文。")).toBe("本文。知らんけど。");
  });

  it("{name} をプレイヤー名に置きかえる", () => {
    expect(makeSpeaker(book({ opening: [{ text: "{name}さん、" }] }), makeRng(1), "テスト")("opening", "本文。")).toBe("テストさん、本文。");
  });

  it("ひととおり使い切るまで、同じ言い回しを繰り返さない", () => {
    const texts = ["あ、", "い、", "う、"];
    const say = makeSpeaker(book({ roast: texts.map((text) => ({ text })) }), makeRng(7), "テスト");
    const firstRound = [say("roast", "x"), say("roast", "x"), say("roast", "x")];
    expect(new Set(firstRound).size).toBe(3);
    // 4回目からは二巡目
    expect(texts.map((t) => `${t}x`)).toContain(say("roast", "x"));
  });

  it("別の場所でもう使った言い回しは、ほかに残っていれば後回しにする", () => {
    const shared = { text: "同じ、" };
    const say = makeSpeaker(book({ accept: [shared], reject: [shared, { text: "別の、" }] }), makeRng(3), "テスト");
    expect(say("accept", "x")).toBe("同じ、x");
    expect(say("reject", "x")).toBe("別の、x");
  });
});

describe("buildReview と口ぐせ", () => {
  const all = book(Object.fromEntries(SLOTS.map((slot) => [slot, [{ text: `【${slot}】、` }]])));

  it("口ぐせを足しても、元の評価文は変わらない(前に付くだけ)", () => {
    for (const s of SAMPLE_PLAYERS) {
      const plain = review(s.id);
      const spoken = review(s.id, all);
      expect(spoken.opening).toBe(`【opening】、${plain.opening}`);
      expect(spoken.homework).toBe(`【homework】、${plain.homework}`);
      spoken.replies.forEach((reply, i) => {
        expect(reply.text).toBe(`【${reply.accepted ? "accept" : "reject"}】、${plain.replies[i].text}`);
      });
      spoken.roasts.forEach((roast, i) => expect(roast.text).toBe(`【roast】、${plain.roasts[i].text}`));
      // 称号には付けない
      expect(spoken.title).toBe(plain.title);
    }
  });

  it("総評は、評価の高さで使う場所が変わる", () => {
    expect(review("jg-solid", all).verdict.startsWith("【verdictHigh】")).toBe(true);
    expect(review("mid-feeder", all).verdict.startsWith("【verdictLow】")).toBe(true);
  });

  it("同じ人・同じ variant なら、口ぐせの選ばれ方も同じ", () => {
    const many = book({ roast: ["あ、", "い、", "う、", "え、"].map((text) => ({ text })) });
    expect(review("mid-feeder", many, 1)).toEqual(review("mid-feeder", many, 1));
  });
});

describe("BUILTIN_PHRASES", () => {
  it("どの場所も、読み込みと同じ決まり(80文字まで・空でない)を守っている", () => {
    expect(parsePhrases(BUILTIN_PHRASES)).toEqual(BUILTIN_PHRASES);
  });
});
