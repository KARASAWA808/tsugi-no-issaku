import { describe, expect, it } from "vitest";
import { CATALOG, type Work } from "../src/catalog";
import { LIKED_RATING, RATING_WEIGHT, diagnose, tagScores, type Rated } from "../src/diagnose";
import { WORKS_PER_QUIZ, createQuiz } from "../src/quiz";
import {
  parse, quizCatalog, rate, ratingOf, seenList, serialize, unrate, unseenOf, type Rating, type Seen,
} from "../src/seen";

function seeded(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

const seenOf = (works: Work[], rating: Rating = 4): Seen => {
  const s: Seen = new Map();
  works.forEach((w) => rate(s, w.title, rating));
  return s;
};
const ratedAs = (works: Work[], rating: Rating): Rated[] => works.map((work) => ({ work, rating }));
const withTag = (tag: string) => CATALOG.filter((w) => w.tags.includes(tag));

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

describe("設問に使う作品", () => {
  it("見た作品は出さない", () => {
    const s = seenOf(CATALOG.slice(0, 20));
    const { works, filled } = quizCatalog(CATALOG, s, seeded(1));
    expect(filled).toBe(0);
    expect(works.some((w) => s.has(w.title))).toBe(false);
  });

  it("見ていない作品が足りないときだけ、見た作品で30作まで埋める", () => {
    const unseenCount = 12;
    const s = seenOf(CATALOG.slice(unseenCount));
    const { works, filled } = quizCatalog(CATALOG, s, seeded(2));
    expect(works).toHaveLength(WORKS_PER_QUIZ);
    expect(filled).toBe(WORKS_PER_QUIZ - unseenCount);
    for (const w of CATALOG.slice(0, unseenCount)) expect(works).toContain(w);
    expect(new Set(works).size).toBe(works.length);
  });

  it("種類でしぼって30作に満たないときは、しぼった作品の数までしか埋めない", () => {
    const small = CATALOG.slice(0, 14);
    const s = seenOf(small.slice(0, 9));
    const { works, filled } = quizCatalog(small, s, seeded(3));
    expect(works).toHaveLength(14);
    expect(filled).toBe(9);
    expect(createQuiz(works, seeded(3)).total).toBe(3);
  });

  it("全部見ていても設問は作れる", () => {
    const { works, filled } = quizCatalog(CATALOG, seenOf(CATALOG), seeded(4));
    expect(works).toHaveLength(WORKS_PER_QUIZ);
    expect(filled).toBe(WORKS_PER_QUIZ);
  });
});

describe("☆の評価だけで診断する", () => {
  const brainy = withTag("頭脳戦");
  const cozy = withTag("日常").filter((w) => !w.tags.includes("頭脳戦"));

  it("☆の重みは高いほど好みに近づき、☆3はどちらでもない", () => {
    expect(RATING_WEIGHT[5]).toBeGreaterThan(RATING_WEIGHT[4]);
    expect(RATING_WEIGHT[4]).toBeGreaterThan(0);
    expect(RATING_WEIGHT[3]).toBe(0);
    expect(RATING_WEIGHT[2]).toBeLessThan(0);
    expect(RATING_WEIGHT[1]).toBeLessThan(RATING_WEIGHT[2]);
  });

  it("☆5を付けた作品のタグが上位に来る", () => {
    const d = diagnose({ ratings: ratedAs(brainy.slice(0, 5), 5), catalog: CATALOG });
    expect(d.tags[0]).toBe("頭脳戦");
    expect(d.recommendations).toHaveLength(6);
    expect(d.typeName).toMatch(/派$/);
  });

  it("☆1を付けると、そのタグは好みから外れる", () => {
    const ratings = [...ratedAs(cozy.slice(0, 3), 4), ...ratedAs(brainy.slice(0, 4), 1)];
    const d = diagnose({ ratings, catalog: CATALOG });
    expect(d.tags).not.toContain("頭脳戦");
    expect(tagScores(ratings).get("頭脳戦")!).toBeLessThan(0);
  });

  it("☆3だけなら傾向は出ず、おすすめもない", () => {
    const d = diagnose({ ratings: ratedAs(CATALOG.slice(0, 5), 3), catalog: CATALOG });
    expect(d.tags).toEqual([]);
    expect(d.recommendations).toEqual([]);
    expect(d.typeName).toBe("まだ見えない派");
    expect(d.summary).toContain("☆4以上");
  });

  it("評価がひとつもなければ、その理由を返す", () => {
    const d = diagnose({ ratings: [], catalog: CATALOG });
    expect(d.recommendations).toEqual([]);
    expect(d.summary).toContain("☆を付けた作品がなかった");
  });

  it("おすすめの元はいつも☆4以上で、重なりが同じなら☆5を優先する", () => {
    const ratings = [...ratedAs(brainy.slice(0, 3), 4), ...ratedAs(brainy.slice(3, 6), 5), ...ratedAs(cozy.slice(0, 3), 2)];
    const d = diagnose({ ratings, catalog: CATALOG, count: CATALOG.length });
    expect(d.recommendations.length).toBeGreaterThan(0);
    for (const r of d.recommendations) {
      expect(r.fromRating).toBeGreaterThanOrEqual(LIKED_RATING);
      expect(ratings.find((x) => x.work === r.from)?.rating).toBe(r.fromRating);
    }
  });

  it("評価した作品は、どの☆でもおすすめに出ない", () => {
    const ratings = [...ratedAs(brainy.slice(0, 4), 5), ...ratedAs(brainy.slice(4, 8), 1), ...ratedAs(brainy.slice(8, 10), 3)];
    const d = diagnose({ ratings, catalog: CATALOG, count: CATALOG.length });
    const rated = new Set(ratings.map((r) => r.work));
    expect(d.recommendations.some((r) => rated.has(r.work))).toBe(false);
  });

  it("評価を足すとおすすめから外れ、次点で埋まる", () => {
    const base = ratedAs(brainy.slice(0, 4), 5);
    const before = diagnose({ ratings: base, catalog: CATALOG });
    const added = [...base, ...ratedAs(before.recommendations.slice(0, 2).map((r) => r.work), 3)];
    const after = diagnose({ ratings: added, catalog: unseenOf(CATALOG, seenOf(added.map((r) => r.work))) });
    expect(after.recommendations).toHaveLength(6);
    expect(after.recommendations.some((r) => before.recommendations.slice(0, 2).some((b) => b.work === r.work))).toBe(false);
  });

  it("おすすめは渡したカタログの中からだけ選ぶ", () => {
    const novels = CATALOG.filter((w) => w.media === "小説");
    const d = diagnose({ ratings: ratedAs(brainy.slice(0, 5), 5), catalog: novels });
    expect(d.recommendations.length).toBeGreaterThan(0);
    expect(d.recommendations.every((r) => r.work.media === "小説")).toBe(true);
  });
});
