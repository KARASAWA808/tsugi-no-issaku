import { describe, expect, it } from "vitest";
import pool from "../data/quiz-pool.json";
import madb from "../data/madb/tagged.json";
import tmdbAnime from "../data/tmdb/anime.json";
import tmdb from "../data/tmdb/tagged.json";
import { CATALOG, MEDIA, isHandwritten, keyOf, type Work } from "../src/catalog";
import { matches } from "../src/filter";
import { isImportedEntry, mergeImported, titleKey } from "../src/imported";
import { HANDWRITTEN_PER_QUESTION, OPTIONS_PER_QUESTION, createQuiz, currentRound, next, shownWorks, swap } from "../src/quiz";
import { quizCatalog, rate, type Seen } from "../src/seen";

function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const entries = pool as unknown[];
const poolWorks = mergeImported(CATALOG, entries);

describe("生成した data/quiz-pool.json(設問に出す候補)", () => {
  it("種類ごとに200〜400作、合計1,500作以内で、ページ読み込みに耐える大きさ", () => {
    for (const m of MEDIA) {
      if (m === "小説") continue; // 小説はまだ取り込んでいない
      const n = poolWorks.filter((w) => w.media === m).length;
      expect(n, m).toBeGreaterThanOrEqual(200);
      expect(n, m).toBeLessThanOrEqual(400);
    }
    expect(poolWorks.length).toBeLessThanOrEqual(1500);
    expect(JSON.stringify(entries).length).toBeLessThan(220_000);
  });

  it("全件が取り込んだ作品(tagged.json / anime.json)にあり、手書きと重ならず、キーも重複しない", () => {
    const known = new Set([...(madb as unknown[]), ...(tmdb as unknown[]), ...(tmdbAnime as unknown[])]
      .filter(isImportedEntry).map((e) => `${e.source ?? "madb"}:${e.id}`));
    const hand = new Set(CATALOG.map((w) => `${w.media}:${titleKey(w.title)}`));
    const keys = new Set<string>();
    for (const e of entries) {
      expect(isImportedEntry(e)).toBe(true);
      if (!isImportedEntry(e)) continue;
      expect(known.has(`${e.source ?? "madb"}:${e.id}`), e.id).toBe(true);
      expect(hand.has(`${e.media}:${titleKey(e.title)}`), e.title).toBe(false);
    }
    expect(poolWorks.length).toBe(entries.length);
    for (const w of poolWorks) {
      expect(isHandwritten(w)).toBe(false);
      expect(keys.has(keyOf(w)), w.title).toBe(false);
      keys.add(keyOf(w));
    }
  });
});

describe("取り込んだ作品を設問にまぜる", () => {
  const all = CATALOG.concat(poolWorks);

  it("手書きが山に残っているあいだは、各設問に手書きが2作以上入る", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const quiz = createQuiz(all, seeded(seed));
      for (let i = 0; i < quiz.total; i++) {
        const opts = currentRound(quiz).options;
        expect(opts).toHaveLength(OPTIONS_PER_QUESTION);
        expect(opts.filter(isHandwritten).length).toBeGreaterThanOrEqual(HANDWRITTEN_PER_QUESTION);
        expect(opts.some((w) => !isHandwritten(w))).toBe(true);
        next(quiz);
      }
      expect(new Set(shownWorks(quiz).map(keyOf)).size).toBe(shownWorks(quiz).length);
    }
  });

  it("「6つとも知らない」で入れ替えても手書きが入り、出した作品は重複しない", () => {
    const quiz = createQuiz(all, seeded(7));
    for (let i = 0; i < 5; i++) expect(swap(quiz)).toBe(true);
    expect(currentRound(quiz).options.filter(isHandwritten).length).toBeGreaterThanOrEqual(HANDWRITTEN_PER_QUESTION);
    for (let i = 0; i < quiz.total - 1; i++) next(quiz);
    expect(new Set(shownWorks(quiz).map(keyOf)).size).toBe(shownWorks(quiz).length);
  });

  it("手書きが尽きれば取り込んだ作品だけで設問が続く。候補がなければ手書きだけで動く", () => {
    const few = CATALOG.slice(0, 3).concat(poolWorks.slice(0, 60));
    const quiz = createQuiz(few, seeded(1));
    expect(currentRound(quiz).options.filter(isHandwritten).length).toBe(2);
    next(quiz);
    expect(currentRound(quiz).options.filter(isHandwritten).length).toBe(1);
    next(quiz);
    expect(currentRound(quiz).options.filter(isHandwritten).length).toBe(0);
    expect(currentRound(quiz).options).toHaveLength(OPTIONS_PER_QUESTION);

    const onlyHand = createQuiz(CATALOG, seeded(1));
    expect(currentRound(onlyHand).options.every(isHandwritten)).toBe(true);
    expect(mergeImported(CATALOG, [null, 1, "x", { id: 1 }])).toEqual([]);
  });

  it("種類・ジャンルのしぼりこみと評価済みの除外は、取り込んだ作品にも効く", () => {
    const filter = { media: new Set<Work["media"]>(["映画"]), moods: new Set(["ハラハラする"]) };
    const hit = all.filter((w) => matches(w, filter));
    expect(hit.some((w) => !isHandwritten(w))).toBe(true);
    expect(hit.every((w) => w.media === "映画" && (w.tags.includes("サスペンス") || w.tags.includes("頭脳戦")))).toBe(true);

    const seen: Seen = new Map();
    const rated = hit.filter((w) => !isHandwritten(w)).slice(0, 5);
    for (const w of rated) rate(seen, keyOf(w), 4);
    const { works } = quizCatalog(hit, seen, seeded(1));
    for (const w of rated) expect(works.includes(w), w.title).toBe(false);
    const quiz = createQuiz(works, seeded(1));
    for (const w of currentRound(quiz).options) expect(w.media).toBe("映画");
  });
});
