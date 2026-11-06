import { describe, expect, it } from "vitest";
import { CATALOG, MEDIA } from "../src/catalog";
import { diagnose } from "../src/diagnose";
import {
  TOTAL_QUESTIONS, back, canSwap, createQuiz, currentRound, isDone, isLastQuestion, isPicked,
  next, passedWorks, pickedWorks, swap, toggle,
} from "../src/quiz";

// 再現できる乱数
function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

/** 各設問で i%3 作を選んで最後まで進める(0作・1作・2作が混ざる) */
function answerAll(seed = 1) {
  const quiz = createQuiz(CATALOG, seeded(seed));
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const { options } = currentRound(quiz);
    for (let k = 0; k < i % 3; k++) toggle(quiz, options[k]);
    next(quiz);
  }
  return quiz;
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
  it("どの種類にも作品がある(しぼりこみが空にならない)", () => {
    for (const m of MEDIA) {
      expect(CATALOG.filter((w) => w.media === m).length, m).toBeGreaterThan(0);
    }
  });
  it("タグは他の作品とも共有されている(孤立タグがない)", () => {
    const count = new Map<string, number>();
    for (const w of CATALOG) for (const t of w.tags) count.set(t, (count.get(t) ?? 0) + 1);
    for (const [tag, n] of count) expect(n, tag).toBeGreaterThan(1);
  });
});

describe("quiz", () => {
  it("10問で終わり、30作に重複がない", () => {
    const quiz = answerAll();
    expect(isDone(quiz)).toBe(true);
    // 0+1+2 を3周 + 最後(i=9)の0作 = 9作
    expect(pickedWorks(quiz)).toHaveLength(9);
    expect(passedWorks(quiz)).toHaveLength(21);
    const shown = quiz.rounds.flatMap((r) => r.options);
    expect(new Set(shown).size).toBe(30);
  });

  it("ひとつの設問で0〜3作を自由に選び、押し直すと外れる", () => {
    const quiz = createQuiz(CATALOG, seeded(2));
    const [a, b, c] = currentRound(quiz).options;
    toggle(quiz, a);
    toggle(quiz, b);
    toggle(quiz, c);
    expect(currentRound(quiz).picks).toEqual([a, b, c]);
    toggle(quiz, b);
    expect(currentRound(quiz).picks).toEqual([a, c]);
    expect(isPicked(quiz, b)).toBe(false);
    expect(isPicked(quiz, c)).toBe(true);
    // 選ぶだけでは進まない
    expect(quiz.index).toBe(0);
    next(quiz);
    expect(quiz.index).toBe(1);
  });

  it("ひとつも選ばずに進めて、全部「選ばなかった」扱いになる", () => {
    const quiz = createQuiz(CATALOG, seeded(6));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) next(quiz);
    expect(isDone(quiz)).toBe(true);
    expect(pickedWorks(quiz)).toHaveLength(0);
    expect(passedWorks(quiz)).toHaveLength(30);
  });

  it("戻っても同じ3作と選択が残り、選び直せる", () => {
    const quiz = createQuiz(CATALOG, seeded(2));
    const first = currentRound(quiz).options;
    toggle(quiz, first[0]);
    next(quiz);
    back(quiz);
    expect(currentRound(quiz).options).toEqual(first);
    expect(currentRound(quiz).picks).toEqual([first[0]]);
    toggle(quiz, first[0]);
    toggle(quiz, first[2]);
    next(quiz);
    expect(quiz.rounds[0].picks).toEqual([first[2]]);
    expect(quiz.index).toBe(1);
  });

  it("最後の設問は「次へ」で診断に入り、戻ると最後の設問に帰る", () => {
    const quiz = answerAll(7);
    expect(isDone(quiz)).toBe(true);
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 1);
    expect(isLastQuestion(quiz)).toBe(true);
    next(quiz); // 終わった後に押しても何も起きない
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 1);
    back(quiz);
    expect(isDone(quiz)).toBe(false);
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 1);
    back(quiz);
    expect(quiz.index).toBe(TOTAL_QUESTIONS - 2);
  });

  it("選択肢にない作品は選べない", () => {
    const quiz = createQuiz(CATALOG, seeded(8));
    const other = CATALOG.find((w) => !currentRound(quiz).options.includes(w))!;
    expect(() => toggle(quiz, other)).toThrow();
  });

  it("入れ替えは作品が足りる間だけできて、選択はリセットされる", () => {
    const quiz = createQuiz(CATALOG, seeded(3));
    const before = currentRound(quiz).options;
    toggle(quiz, before[0]);
    let swaps = 0;
    while (canSwap(quiz)) {
      expect(swap(quiz)).toBe(true);
      swaps++;
    }
    expect(swaps).toBe(Math.floor((CATALOG.length - 30) / 3));
    expect(currentRound(quiz).options).not.toEqual(before);
    expect(currentRound(quiz).picks).toEqual([]);
    expect(swap(quiz)).toBe(false);
    // 入れ替えを使い切っても10問最後まで出せる
    for (let i = 0; i < TOTAL_QUESTIONS; i++) {
      expect(currentRound(quiz).options).toHaveLength(3);
      toggle(quiz, currentRound(quiz).options[0]);
      next(quiz);
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

  it("ひとつも選ばなかったときは、おすすめなしで理由を返す", () => {
    const quiz = createQuiz(CATALOG, seeded(9));
    for (let i = 0; i < TOTAL_QUESTIONS; i++) next(quiz);
    const d = diagnose({ picked: pickedWorks(quiz), passed: passedWorks(quiz), catalog: CATALOG });
    expect(d.recommendations).toHaveLength(0);
    expect(d.tags).toHaveLength(0);
    expect(d.summary).toContain("なかった");
  });

  it("種類でしぼりこめる", () => {
    const quiz = answerAll(5);
    for (const m of MEDIA) {
      const d = diagnose({
        picked: pickedWorks(quiz), passed: passedWorks(quiz), catalog: CATALOG, media: new Set([m]),
      });
      expect(d.recommendations.length, m).toBeGreaterThan(0);
      expect(d.recommendations.every((r) => r.work.media === m), m).toBe(true);
    }
  });

  it("頭脳戦の作品を選ぶと頭脳戦が上位に来る", () => {
    const brainy = CATALOG.filter((w) => w.tags.includes("頭脳戦")).slice(0, 10);
    const d = diagnose({ picked: brainy, passed: [], catalog: CATALOG });
    expect(d.tags[0]).toBe("頭脳戦");
  });
});
