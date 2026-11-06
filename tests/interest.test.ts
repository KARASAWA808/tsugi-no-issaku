import { describe, expect, it } from "vitest";
import { CATALOG, type Work } from "../src/catalog";
import { INTEREST_WEIGHT, LIKED_RATING, RATING_WEIGHT, diagnose, tagScores, type Rated } from "../src/diagnose";
import {
  interestList, isInterested, mark, parseInterest, rateAndClear, serializeInterest, toggle, unmark, type Interest,
} from "../src/interest";
import { ratingOf, type Seen } from "../src/seen";

const ratedAs = (works: Work[], rating: Rated["rating"]): Rated[] => works.map((work) => ({ work, rating }));
const withTag = (tag: string) => CATALOG.filter((w) => w.tags.includes(tag));

describe("気になるの記録", () => {
  it("付ける・外す・切り替える", () => {
    const i: Interest = new Set();
    const w = CATALOG[0];
    mark(i, w.title);
    expect(isInterested(i, w)).toBe(true);
    mark(i, w.title);
    expect(i.size).toBe(1);
    unmark(i, w.title);
    expect(isInterested(i, w)).toBe(false);
    expect(toggle(i, w.title)).toBe(true);
    expect(isInterested(i, w)).toBe(true);
    expect(toggle(i, w.title)).toBe(false);
    expect(isInterested(i, w)).toBe(false);
  });

  it("空の作品名は付けない", () => {
    const i: Interest = new Set();
    mark(i, "");
    expect(i.size).toBe(0);
  });

  it("☆を付けると気になるは自動で外れる。気になるを付けても☆は変わらない", () => {
    const seen: Seen = new Map();
    const i: Interest = new Set();
    const [a, b] = CATALOG;
    mark(i, a.title);
    rateAndClear(seen, i, a.title, 4);
    expect(ratingOf(seen, a)).toBe(4);
    expect(isInterested(i, a)).toBe(false);
    // 見た作品に気になるを付けても、☆はそのまま
    toggle(i, b.title);
    toggle(i, a.title);
    expect(ratingOf(seen, a)).toBe(4);
    expect(ratingOf(seen, b)).toBeUndefined();
  });

  it("一覧はカタログ順で、カタログにない作品名は出さない", () => {
    const i: Interest = new Set([CATALOG[5].title, "カタログから消えた作品", CATALOG[2].title]);
    expect(interestList(CATALOG, i)).toEqual([CATALOG[2], CATALOG[5]]);
  });
});

describe("気になるの保存と読み込み", () => {
  it("書き出して読み戻すと同じになる。カタログにない作品名も消さない", () => {
    const i: Interest = new Set([CATALOG[0].title, "カタログから消えた作品"]);
    expect(parseInterest(serializeInterest(i))).toEqual(i);
  });

  it("壊れたデータでも例外を出さず、読めた分だけ返す", () => {
    expect(parseInterest(null).size).toBe(0);
    expect(parseInterest("").size).toBe(0);
    expect(parseInterest("{壊れた").size).toBe(0);
    expect(parseInterest("null").size).toBe(0);
    expect(parseInterest("[1,2]").size).toBe(0);
    expect(parseInterest(JSON.stringify({ titles: { A: 1 } })).size).toBe(0);
    const partial = parseInterest(JSON.stringify({ version: 1, titles: ["A", 3, "", null, "B"] }));
    expect([...partial]).toEqual(["A", "B"]);
  });
});

describe("気になるは診断の弱い手がかり", () => {
  const brainy = withTag("頭脳戦");
  const cozy = withTag("日常").filter((w) => !w.tags.includes("頭脳戦"));

  it("重みは☆4と同じで、☆5より弱い", () => {
    expect(INTEREST_WEIGHT).toBe(RATING_WEIGHT[4]);
    expect(INTEREST_WEIGHT).toBeLessThan(RATING_WEIGHT[5]);
  });

  it("気になる作品のタグに +0.5 が足される", () => {
    const scores = tagScores([], cozy.slice(0, 2));
    expect(scores.get("日常")).toBe(INTEREST_WEIGHT * 2);
    // ☆の評価と合算される
    const mixed = tagScores(ratedAs(cozy.slice(0, 1), 5), cozy.slice(1, 2));
    expect(mixed.get("日常")).toBe(RATING_WEIGHT[5] + INTEREST_WEIGHT);
  });

  it("気になるだけでは好みタイプもおすすめも出ない(おすすめの元は☆4以上だけ)", () => {
    const d = diagnose({ ratings: [], interested: brainy.slice(0, 5), catalog: CATALOG });
    expect(d.tags).toEqual([]);
    expect(d.recommendations).toEqual([]);
    expect(d.typeName).toBe("まだ見えない派");
  });

  it("気になる作品はおすすめの元(from)にならない", () => {
    const ratings = ratedAs(cozy.slice(0, 2), 5);
    const interested = brainy.slice(0, 5);
    const d = diagnose({ ratings, interested, catalog: CATALOG, count: CATALOG.length });
    expect(d.recommendations.length).toBeGreaterThan(0);
    for (const r of d.recommendations) {
      expect(interested).not.toContain(r.from);
      expect(r.fromRating).toBeGreaterThanOrEqual(LIKED_RATING);
    }
  });

  it("気になる作品のタグが好みに足されて、タグの順位が動く", () => {
    const ratings = [...ratedAs(cozy.slice(0, 2), 5), ...ratedAs(brainy.slice(0, 1), 4)];
    const without = diagnose({ ratings, catalog: CATALOG });
    const withInterest = diagnose({ ratings, interested: brainy.slice(1, 8), catalog: CATALOG });
    expect(without.tags[0]).toBe("日常");
    expect(withInterest.tags[0]).toBe("頭脳戦");
    expect(withInterest.typeName).toMatch(/^頭脳戦×/);
  });

  it("気になる作品はおすすめから外さず、印が付く", () => {
    const ratings = ratedAs(brainy.slice(0, 3), 5);
    const base = diagnose({ ratings, catalog: CATALOG });
    const target = base.recommendations[0].work;
    const d = diagnose({ ratings, interested: [target], catalog: CATALOG });
    const hit = d.recommendations.find((r) => r.work === target);
    expect(hit?.interested).toBe(true);
    expect(d.recommendations.filter((r) => r.work !== target).every((r) => r.interested === false)).toBe(true);
  });

  it("同点なら気になる作品を先に出す", () => {
    const mk = (title: string): Work => ({ title, media: "漫画", tags: ["頭脳戦", "サスペンス"], pitch: "-" });
    const liked = mk("好き");
    const [a, b, c] = [mk("A"), mk("B"), mk("C")];
    const ratings = [{ work: liked, rating: 5 as const }];
    const plain = diagnose({ ratings, catalog: [liked, a, b, c] });
    expect(plain.recommendations.map((r) => r.work.title)).toEqual(["A", "B", "C"]);
    const d = diagnose({ ratings, interested: [c], catalog: [liked, a, b, c] });
    expect(d.recommendations.map((r) => r.work.title)).toEqual(["C", "A", "B"]);
    // 3作は同じタグなので同点のまま(気になるの +0.5 も3作に等しく足される)
    expect(new Set(d.recommendations.map((r) => r.score)).size).toBe(1);
  });

  it("☆を付けた作品が気になるにも残っていたら、☆の方だけを使う", () => {
    const w = brainy[0];
    const ratings = [...ratedAs([w], 4), ...ratedAs(cozy.slice(0, 1), 5)];
    const plain = diagnose({ ratings, catalog: CATALOG });
    const d = diagnose({ ratings, interested: [w], catalog: CATALOG });
    // 気になるの +0.5 は足されず、結果は気になるなしと同じになる
    expect(d).toEqual(plain);
    expect(d.recommendations.some((r) => r.work === w)).toBe(false);
  });
});
