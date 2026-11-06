import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog";
import { diagnose } from "../src/diagnose";
import {
  TOTAL_QUESTIONS, WORKS_PER_QUIZ, createQuiz, currentRound, next, passedWorks, pickedWorks, toggle,
} from "../src/quiz";
import { parse, quizCatalog, rate, ratingOf, seenList, serialize, unrate, unseenOf, type Seen } from "../src/seen";

function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const seenOf = (works: typeof CATALOG, rating: 1 | 2 | 3 | 4 | 5 = 4): Seen => {
  const s: Seen = new Map();
  works.forEach((w) => rate(s, w.title, rating));
  return s;
};

describe("評価の記録", () => {
  it("付ける・付け直す・取り消す", () => {
    const s: Seen = new Map();
    const w = CATALOG[0];
    rate(s, w.title, 3);
    expect(ratingOf(s, w)).toBe(3);
    rate(s, w.title, 5);
    expect(ratingOf(s, w)).toBe(5);
    unrate(s, w.title);
    expect(ratingOf(s, w)).toBeUndefined();
  });

  it("1〜5以外は付けられない", () => {
    expect(() => rate(new Map(), CATALOG[0].title, 0 as never)).toThrow();
    expect(() => rate(new Map(), CATALOG[0].title, 6 as never)).toThrow();
  });

  it("一覧は評価の高い順で、カタログにない作品名は出さない", () => {
    const s: Seen = new Map();
    rate(s, CATALOG[3].title, 2);
    rate(s, CATALOG[1].title, 5);
    rate(s, CATALOG[2].title, 5);
    rate(s, "カタログから消えた作品", 4);
    const list = seenList(CATALOG, s);
    expect(list.map((x) => x.work.title)).toEqual([CATALOG[1].title, CATALOG[2].title, CATALOG[3].title]);
    expect(list.map((x) => x.rating)).toEqual([5, 5, 2]);
  });
});

describe("保存と読み込み", () => {
  it("書き出して読み戻すと同じになる。カタログにない作品名も消さない", () => {
    const s: Seen = new Map();
    rate(s, CATALOG[0].title, 4);
    rate(s, "カタログから消えた作品", 1);
    expect(parse(serialize(s))).toEqual(s);
  });

  it("壊れたデータでも例外を出さず、読めた分だけ返す", () => {
    expect(parse(null).size).toBe(0);
    expect(parse("").size).toBe(0);
    expect(parse("{壊れた").size).toBe(0);
    expect(parse("null").size).toBe(0);
    expect(parse("[1,2]").size).toBe(0);
    expect(parse(JSON.stringify({ ratings: [3] })).size).toBe(0);
    const partial = parse(JSON.stringify({ version: 1, ratings: { A: 3, B: 9, C: "5", D: 2.5, E: 1 } }));
    expect([...partial.entries()]).toEqual([["A", 3], ["E", 1]]);
  });
});

describe("見た作品を外す", () => {
  it("設問には見た作品が出ない", () => {
    const s = seenOf(CATALOG.slice(0, 20));
    const { works, filled } = quizCatalog(CATALOG, s, seeded(1));
    expect(filled).toBe(0);
    expect(works.some((w) => s.has(w.title))).toBe(false);
    const quiz = createQuiz(works, seeded(1));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options.some((w) => s.has(w.title))).toBe(false);
      next(quiz);
    }
  });

  it("見ていない作品が足りないときだけ、見た作品で30作まで埋める", () => {
    const unseenCount = 12;
    const s = seenOf(CATALOG.slice(unseenCount));
    const { works, filled } = quizCatalog(CATALOG, s, seeded(2));
    expect(works).toHaveLength(WORKS_PER_QUIZ);
    expect(filled).toBe(WORKS_PER_QUIZ - unseenCount);
    // 見ていない作品は全部入る
    for (const w of CATALOG.slice(0, unseenCount)) expect(works).toContain(w);
    expect(new Set(works).size).toBe(works.length);
    // 埋めた後でも10問最後まで出せる
    expect(() => createQuiz(works, seeded(2))).not.toThrow();
  });

  it("全部見ていても診断はできる", () => {
    const { works, filled } = quizCatalog(CATALOG, seenOf(CATALOG), seeded(3));
    expect(works).toHaveLength(WORKS_PER_QUIZ);
    expect(filled).toBe(WORKS_PER_QUIZ);
  });

  it("おすすめには見た作品が出ず、評価した分だけ次の作品で埋まる", () => {
    const quiz = createQuiz(CATALOG, seeded(4));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      toggle(quiz, currentRound(quiz).options[0]);
      next(quiz);
    }
    const input = { picked: pickedWorks(quiz), passed: passedWorks(quiz) };
    const before = diagnose({ ...input, catalog: CATALOG });
    const s = seenOf(before.recommendations.slice(0, 2).map((r) => r.work));
    const after = diagnose({ ...input, catalog: unseenOf(CATALOG, s) });
    expect(after.recommendations).toHaveLength(6);
    expect(after.recommendations.some((r) => s.has(r.work.title))).toBe(false);
    // 残った4作は順番も変わらない
    expect(after.recommendations.slice(0, 4).map((r) => r.work)).toEqual(before.recommendations.slice(2, 6).map((r) => r.work));
  });

  it("設問に見た作品がまざっても、おすすめには出ない", () => {
    const s = seenOf(CATALOG.slice(10));
    const { works } = quizCatalog(CATALOG, s, seeded(5));
    const quiz = createQuiz(works, seeded(5));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      currentRound(quiz).options.forEach((w) => toggle(quiz, w));
      next(quiz);
    }
    const d = diagnose({ picked: pickedWorks(quiz), passed: passedWorks(quiz), catalog: unseenOf(CATALOG, s) });
    expect(d.recommendations.some((r) => s.has(r.work.title))).toBe(false);
  });
});
