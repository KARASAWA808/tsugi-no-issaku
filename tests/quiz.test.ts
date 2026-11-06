import { describe, expect, it } from "vitest";
import { CATALOG, MEDIA } from "../src/catalog";
import {
  OPTIONS_PER_QUESTION, TOTAL_QUESTIONS, WORKS_PER_QUIZ, back, canSwap, createQuiz, currentRound, isDone,
  isLastQuestion, next, shownWorks, swap,
} from "../src/quiz";

// 再現できる乱数
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe("catalog", () => {
  it("作品名が重複していない", () => {
    expect(new Set(CATALOG.map((w) => w.title)).size).toBe(CATALOG.length);
  });
  it("どの作品にもタグとひとことがある", () => {
    for (const w of CATALOG) {
      expect(w.tags.length, w.title).toBeGreaterThan(0);
      expect(new Set(w.tags).size, w.title).toBe(w.tags.length);
      expect(w.pitch, w.title).not.toBe("");
    }
  });
  it("どの種類にも20作以上あり、隠れた名作もある", () => {
    for (const m of MEDIA) {
      const works = CATALOG.filter((w) => w.media === m);
      expect(works.length, m).toBeGreaterThanOrEqual(20);
      expect(works.some((w) => w.gem), m).toBe(true);
    }
  });
  it("タグは決まった18個だけを使い、1作に2〜4個", () => {
    const allowed = new Set([
      "冒険", "仲間", "バトル", "世界観", "ダーク", "サスペンス", "頭脳戦", "ファンタジー", "切なさ",
      "日常", "成長", "感動", "笑い", "哲学", "歴史", "恋愛", "SF", "ミステリー",
    ]);
    for (const w of CATALOG) {
      expect(w.tags.length, w.title).toBeGreaterThanOrEqual(2);
      expect(w.tags.length, w.title).toBeLessThanOrEqual(4);
      for (const t of w.tags) expect(allowed.has(t), `${w.title}: ${t}`).toBe(true);
    }
  });
  it("タグは他の作品とも共有されている(孤立タグがない)", () => {
    const count = new Map<string, number>();
    for (const w of CATALOG) for (const t of w.tags) count.set(t, (count.get(t) ?? 0) + 1);
    for (const [tag, n] of count) expect(n, tag).toBeGreaterThan(1);
  });
});

describe("quiz", () => {
  it("全カタログなら6作×5問で、30作に重複がない", () => {
    const quiz = createQuiz(CATALOG, seeded(1));
    expect(quiz.total).toBe(TOTAL_QUESTIONS);
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options).toHaveLength(OPTIONS_PER_QUESTION);
      expect(isDone(quiz)).toBe(false);
      next(quiz);
    }
    expect(isDone(quiz)).toBe(true);
    const shown = shownWorks(quiz);
    expect(shown).toHaveLength(WORKS_PER_QUIZ);
    expect(new Set(shown).size).toBe(WORKS_PER_QUIZ);
  });

  it("作品が少なければ設問は短くなり、最後の問は残りの数だけ出る", () => {
    const quiz = createQuiz(CATALOG.slice(0, 10), seeded(2));
    expect(quiz.total).toBe(2);
    expect(currentRound(quiz).options).toHaveLength(6);
    expect(isLastQuestion(quiz)).toBe(false);
    next(quiz);
    expect(currentRound(quiz).options).toHaveLength(4);
    expect(isLastQuestion(quiz)).toBe(true);
    next(quiz);
    expect(isDone(quiz)).toBe(true);
    expect(new Set(shownWorks(quiz)).size).toBe(10);
  });

  it("作品がひとつもなければ作れない", () => {
    expect(() => createQuiz([])).toThrow();
  });

  it("戻っても同じ6作が出る", () => {
    const quiz = createQuiz(CATALOG, seeded(3));
    const first = currentRound(quiz).options;
    next(quiz);
    const second = currentRound(quiz).options;
    back(quiz);
    expect(currentRound(quiz).options).toEqual(first);
    next(quiz);
    expect(currentRound(quiz).options).toEqual(second);
  });

  it("最後の設問の「診断する」で終わり、戻ると最後の設問に帰る", () => {
    const quiz = createQuiz(CATALOG, seeded(4));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) next(quiz);
    expect(isDone(quiz)).toBe(true);
    next(quiz); // 終わった後に押しても何も起きない
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 1);
    back(quiz);
    expect(isDone(quiz)).toBe(false);
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 1);
    back(quiz);
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 2);
  });

  it("入れ替えは作品が足りる間だけできて、使い切っても最後まで6作ずつ出る", () => {
    const quiz = createQuiz(CATALOG, seeded(5));
    const before = currentRound(quiz).options;
    let swaps = 0;
    while (canSwap(quiz)) {
      expect(swap(quiz)).toBe(true);
      swaps++;
    }
    expect(swaps).toBe(Math.floor((CATALOG.length - WORKS_PER_QUIZ) / OPTIONS_PER_QUESTION));
    expect(currentRound(quiz).options.some((w) => before.includes(w))).toBe(false);
    expect(swap(quiz)).toBe(false);
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options).toHaveLength(OPTIONS_PER_QUESTION);
      next(quiz);
    }
    expect(isDone(quiz)).toBe(true);
  });

  it("戻ってから入れ替えると、先の設問の作品は山に戻り、新しい6作とは重ならない", () => {
    const quiz = createQuiz(CATALOG, seeded(6));
    next(quiz);
    next(quiz);
    const ahead = [...quiz.rounds[1].options, ...quiz.rounds[2].options];
    back(quiz);
    back(quiz);
    const old = currentRound(quiz).options;
    const poolBefore = quiz.pool.length;
    expect(swap(quiz)).toBe(true);
    const fresh = currentRound(quiz).options;
    expect(quiz.rounds).toHaveLength(1);
    expect(fresh.some((w) => old.includes(w) || ahead.includes(w))).toBe(false);
    for (const w of ahead) expect(quiz.pool).toContain(w);
    expect(quiz.pool.length).toBe(poolBefore + ahead.length - OPTIONS_PER_QUESTION);
    // そのあとも最後まで6作ずつ出せる
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options).toHaveLength(OPTIONS_PER_QUESTION);
      next(quiz);
    }
  });

  it("最後の設問が短くなっても残りが出せるなら入れ替えられる", () => {
    const quiz = createQuiz(CATALOG.slice(0, 32), seeded(8));
    expect(quiz.total).toBe(TOTAL_QUESTIONS);
    expect(canSwap(quiz)).toBe(true);
    expect(swap(quiz)).toBe(true);
    expect(canSwap(quiz)).toBe(false);
    const sizes = [];
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      sizes.push(currentRound(quiz).options.length);
      next(quiz);
    }
    expect(sizes).toEqual([6, 6, 6, 6, 2]);
    expect(isDone(quiz)).toBe(true);
  });

  it("作品が少ないと入れ替えはできない", () => {
    expect(canSwap(createQuiz(CATALOG.slice(0, 12), seeded(7)))).toBe(false);
  });
});
