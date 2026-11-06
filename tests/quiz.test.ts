import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog";
import { diagnose } from "../src/diagnose";
import {
  TOTAL_QUESTIONS, back, canSwap, choose, createQuiz, currentRound, isDone,
  passedWorks, pickedWorks, swap,
} from "../src/quiz";

// 再現できる乱数
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function answerAll(seed = 1) {
  const quiz = createQuiz(CATALOG, seeded(seed));
  for (let i = 0; i < TOTAL_QUESTIONS; i++) choose(quiz, currentRound(quiz).options[i % 3]);
  return quiz;
}

describe("catalog", () => {
  it("作品名が重複していない", () => {
    expect(new Set(CATALOG.map((w) => w.title)).size).toBe(CATALOG.length);
  });
  it("どの作品にもタグとひとことがある", () => {
    for (const w of CATALOG) {
      expect(w.tags.length, w.title).toBeGreaterThan(0);
      expect(w.pitch, w.title).not.toBe("");
    }
  });
});

describe("quiz", () => {
  it("10問で終わり、30作に重複がない", () => {
    const quiz = answerAll();
    expect(isDone(quiz)).toBe(true);
    expect(pickedWorks(quiz)).toHaveLength(10);
    expect(passedWorks(quiz)).toHaveLength(20);
    const shown = quiz.rounds.flatMap((r) => r.options);
    expect(new Set(shown).size).toBe(30);
  });

  it("戻っても同じ3作が出て、選び直せる", () => {
    const quiz = createQuiz(CATALOG, seeded(2));
    const first = currentRound(quiz).options;
    choose(quiz, first[0]);
    back(quiz);
    expect(currentRound(quiz).options).toEqual(first);
    choose(quiz, first[2]);
    expect(quiz.rounds[0].pick).toBe(first[2]);
    expect(quiz.index).toBe(1);
  });

  it("入れ替えは作品が足りる間だけできる", () => {
    const quiz = createQuiz(CATALOG, seeded(3));
    const before = currentRound(quiz).options;
    let swaps = 0;
    while (canSwap(quiz)) {
      expect(swap(quiz)).toBe(true);
      swaps++;
    }
    expect(swaps).toBe(Math.floor((CATALOG.length - 30) / 3));
    expect(currentRound(quiz).options).not.toEqual(before);
    expect(swap(quiz)).toBe(false);
    // 入れ替えを使い切っても10問最後まで出せる
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options).toHaveLength(3);
      choose(quiz, currentRound(quiz).options[0]);
    }
    expect(isDone(quiz)).toBe(true);
  });
});

describe("diagnose", () => {
  it("選んだ作品はおすすめに出ず、6作返る", () => {
    const quiz = answerAll(4);
    const picked = pickedWorks(quiz);
    const d = diagnose({ picked, passed: passedWorks(quiz), catalog: CATALOG });
    expect(d.recommendations).toHaveLength(6);
    for (const r of d.recommendations) {
      expect(picked).not.toContain(r.work);
      expect(picked).toContain(r.from);
      expect(r.shared.length).toBeGreaterThan(0);
    }
    expect(d.typeName).toMatch(/派$/);
  });

  it("種類でしぼりこめる", () => {
    const quiz = answerAll(5);
    const d = diagnose({
      picked: pickedWorks(quiz), passed: passedWorks(quiz), catalog: CATALOG, media: new Set(["小説"] as const),
    });
    expect(d.recommendations.length).toBeGreaterThan(0);
    expect(d.recommendations.every((r) => r.work.media === "小説")).toBe(true);
  });

  it("頭脳戦の作品を選ぶと頭脳戦が上位に来る", () => {
    const brainy = CATALOG.filter((w) => w.tags.includes("頭脳戦")).slice(0, 10);
    const d = diagnose({ picked: brainy, passed: [], catalog: CATALOG });
    expect(d.tags[0]).toBe("頭脳戦");
  });
});
