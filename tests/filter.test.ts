import { describe, expect, it } from "vitest";
import { CATALOG, MEDIA, type Media } from "../src/catalog";
import { MOODS, matches, matchesMood } from "../src/filter";

const all = new Set<Media>(MEDIA);
const none = new Set<string>();

describe("ジャンル", () => {
  const catalogTags = new Set(CATALOG.flatMap((w) => w.tags));

  it("ジャンル名は重複せず、どれもカタログにあるタグだけでできている", () => {
    expect(new Set(MOODS.map((m) => m.name)).size).toBe(MOODS.length);
    for (const m of MOODS) {
      expect(m.tags.length, m.name).toBeGreaterThan(0);
      for (const t of m.tags) expect(catalogTags.has(t), `${m.name}: ${t}`).toBe(true);
    }
  });

  it("どのジャンルも3種類以上にまたがって作品がある", () => {
    for (const m of MOODS) {
      const hit = CATALOG.filter((w) => matchesMood(w, new Set([m.name])));
      expect(new Set(hit.map((w) => w.media)).size, m.name).toBeGreaterThanOrEqual(3);
    }
  });

  it("選ばなければすべてに当たり、複数選ぶとどれかに当たる作品になる", () => {
    expect(CATALOG.every((w) => matchesMood(w, none))).toBe(true);
    const cry = CATALOG.filter((w) => matchesMood(w, new Set(["泣ける"])));
    const laugh = CATALOG.filter((w) => matchesMood(w, new Set(["笑える"])));
    const both = CATALOG.filter((w) => matchesMood(w, new Set(["泣ける", "笑える"])));
    expect(new Set(both)).toEqual(new Set([...cry, ...laugh]));
    expect(cry.every((w) => w.tags.includes("感動") || w.tags.includes("切なさ"))).toBe(true);
  });
});

describe("しぼりこみ", () => {
  it("ジャンル指定なしなら、種類だけでしぼったのと同じ", () => {
    const media = new Set<Media>(["漫画", "映画"]);
    expect(CATALOG.filter((w) => matches(w, { media, moods: none })))
      .toEqual(CATALOG.filter((w) => media.has(w.media)));
  });

  it("種類とジャンルは両方に当たる作品だけになる", () => {
    const hit = CATALOG.filter((w) => matches(w, { media: new Set<Media>(["小説"]), moods: new Set(["考えさせられる"]) }));
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every((w) => w.media === "小説" && w.tags.includes("哲学"))).toBe(true);
  });

  it("隠れた名作だけにすると、印の付いた作品だけになる", () => {
    const gems = CATALOG.filter((w) => matches(w, { media: all, moods: none, gemsOnly: true }));
    expect(gems.length).toBeGreaterThan(0);
    expect(gems.every((w) => w.gem === true)).toBe(true);
    expect(gems).toEqual(CATALOG.filter((w) => w.gem));
  });
});
