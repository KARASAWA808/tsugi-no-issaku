import { describe, expect, it } from "vitest";
import { CATALOG } from "../src/catalog";
import { GENRE_TAGS, TAGS, isTag, tagsForGenres } from "../src/tagmap";

describe("好みタグ", () => {
  it("18個で、手書きのカタログで使っているタグとぴったり一致する", () => {
    expect(TAGS.length).toBe(18);
    expect(new Set(TAGS).size).toBe(18);
    expect(new Set(CATALOG.flatMap((w) => w.tags))).toEqual(new Set(TAGS));
  });
});

describe("ジャンル語の対応表", () => {
  it("対応先は18タグだけで、1語あたり1〜3個、重複しない", () => {
    for (const [genre, tags] of Object.entries(GENRE_TAGS)) {
      expect(tags.length, genre).toBeGreaterThanOrEqual(1);
      expect(tags.length, genre).toBeLessThanOrEqual(3);
      expect(new Set(tags).size, genre).toBe(tags.length);
      for (const t of tags) expect(isTag(t), `${genre}: ${t}`).toBe(true);
    }
  });

  it("語の前後の空白は無視し、知らない語は捨て、タグの重複は除く", () => {
    expect(tagsForGenres([" ファンタジー ", "少年漫画", "ダークファンタジー"])).toEqual(["ファンタジー", "ダーク"]);
    expect(tagsForGenres(["少年漫画", "学園もの"])).toEqual([]);
    expect(tagsForGenres([])).toEqual([]);
  });

  it("作風を決めない区分(対象読者や掲載誌)は対応させない", () => {
    for (const g of ["少年漫画", "少女漫画", "青年漫画", "学園もの", "ビジュアルノベル", "スポーツゲーム", "ドラマ"]) {
      expect(GENRE_TAGS[g], g).toBeUndefined();
    }
  });
});
