import { describe, expect, it } from "vitest";
import summary from "../data/madb/summary.json";
import tagged from "../data/madb/tagged.json";
import { CATALOG, MEDIA, keyOf, type Work } from "../src/catalog";
import { diagnose } from "../src/diagnose";
import { MADB_ID_URL, MADB_KEY_PREFIX, isImportedEntry, mergeImported, titleKey, toWork } from "../src/imported";
import { interestList, isInterested, rateAndClear, toggle, type Interest } from "../src/interest";
import { rate, ratingOf, seenList, unseenOf, type Seen } from "../src/seen";
import { TAGS } from "../src/tagmap";

describe("題名の正規化", () => {
  it("版の違いと表記ゆれをそろえる", () => {
    expect(titleKey("鋼の錬金術師 完全版")).toBe(titleKey("鋼の錬金術師"));
    expect(titleKey("ＳＬＡＭ ＤＵＮＫ〔新装版〕")).toBe(titleKey("SLAM DUNK"));
    expect(titleKey("よつばと！")).toBe(titleKey("よつばと!"));
    expect(titleKey("ハイキュー!!")).toBe("ハイキュー");
  });

  it("別の作品はそろえない", () => {
    expect(titleKey("進撃の巨人")).not.toBe(titleKey("進撃の巨人 Before the fall"));
    expect(titleKey("ドラゴンボール")).not.toBe(titleKey("ドラゴンボール超"));
  });
});

describe("取り込んだ作品を Work にする", () => {
  const entry = { id: "C12345", title: "ある作品", media: "漫画" as const, year: 1999, tags: ["冒険"], sitelinks: 3 };

  it("ID をキーにし、出典の作品ページを付け、ひとことは空", () => {
    const w = toWork(entry);
    expect(keyOf(w)).toBe(`${MADB_KEY_PREFIX}C12345`);
    expect(w.source).toEqual({ name: "メディア芸術データベース", url: `${MADB_ID_URL}C12345` });
    expect(w.pitch).toBe("");
    expect(w.year).toBe(1999);
    expect(toWork({ ...entry, year: null }).year).toBeUndefined();
  });

  it("壊れた件は使わない", () => {
    expect(isImportedEntry(entry)).toBe(true);
    expect(isImportedEntry({ ...entry, tags: [] })).toBe(false);
    expect(isImportedEntry({ ...entry, media: "映画館" })).toBe(false);
    expect(isImportedEntry({ ...entry, title: "" })).toBe(false);
    expect(isImportedEntry(null)).toBe(false);
  });

  it("手書きの作品と同じ種類・同じ題名なら手書きを残し、同じ ID は1つにする", () => {
    const hand: Work[] = [{ title: "ある作品", media: "漫画", tags: ["冒険", "仲間"], pitch: "手書き" }];
    const works = mergeImported(hand, [
      entry,
      { ...entry, id: "C2", title: "ある作品 完全版" },
      { ...entry, id: "C3", title: "ある作品", media: "アニメ" },
      { ...entry, id: "C3", title: "重複した ID" },
      { ...entry, id: "C4", tags: [] },
    ]);
    expect(works.map((w) => w.id)).toEqual([`${MADB_KEY_PREFIX}C3`]);
    expect(works[0].media).toBe("アニメ");
  });

  it("手書きの作品の評価は作品名のまま保存され、取り込んだ作品は ID で保存される", () => {
    const seen: Seen = new Map();
    const hand = CATALOG[0];
    const imported = toWork({ ...entry, title: hand.title, media: hand.media });
    rate(seen, keyOf(hand), 5);
    rate(seen, keyOf(imported), 2);
    expect(ratingOf(seen, hand)).toBe(5);
    expect(ratingOf(seen, imported)).toBe(2);
    expect(seen.get(hand.title)).toBe(5);
    expect(seenList([hand, imported], seen).map((r) => r.rating)).toEqual([5, 2]);
    expect(unseenOf([hand, imported], seen)).toEqual([]);
  });

  it("「気になる」も同じキーで付き、☆を付けると外れる", () => {
    const hand = CATALOG[0];
    const imported = toWork({ ...entry, title: hand.title, media: hand.media });
    const interest: Interest = new Set();
    toggle(interest, keyOf(imported));
    expect(isInterested(interest, imported)).toBe(true);
    expect(isInterested(interest, hand)).toBe(false);
    expect(interestList([hand, imported], interest)).toEqual([imported]);
    const seen: Seen = new Map();
    rateAndClear(seen, interest, keyOf(imported), 4);
    expect(interest.size).toBe(0);
    expect(ratingOf(seen, imported)).toBe(4);
  });
});

describe("生成した data/madb/tagged.json", () => {
  const entries = tagged as unknown[];

  it("全件が使える形で、タグは18タグだけ、ID は重複しない", () => {
    expect(entries.length).toBeGreaterThan(1000);
    const ids = new Set<string>();
    for (const e of entries) {
      expect(isImportedEntry(e)).toBe(true);
      if (!isImportedEntry(e)) continue;
      for (const t of e.tags) expect((TAGS as readonly string[]).includes(t), `${e.id}: ${t}`).toBe(true);
      expect(new Set(e.tags).size).toBe(e.tags.length);
      expect(ids.has(e.id), e.id).toBe(false);
      ids.add(e.id);
      if (e.year != null) expect(e.year).toBeGreaterThan(1800);
    }
  });

  it("漫画・アニメ・ゲームが入っていて、件数は summary.json と合う", () => {
    const works = mergeImported(CATALOG, entries);
    const media = new Set(works.map((w) => w.media));
    for (const m of ["漫画", "アニメ", "ゲーム"]) expect(media.has(m as (typeof MEDIA)[number]), m).toBe(true);
    expect(entries.length).toBe(summary.tagged);
    expect(entries.length).toBe(Object.values(summary.byMedia).reduce((n, m) => n + m.tagged, 0));
  });

  it("手書きの作品と ID がぶつからず、おすすめの元にできる", () => {
    const works = mergeImported(CATALOG, entries);
    const keys = new Set(CATALOG.map(keyOf));
    for (const w of works) expect(keys.has(keyOf(w)), w.title).toBe(false);
    const ratings = CATALOG.slice(0, 5).map((work) => ({ work, rating: 5 as const }));
    const d = diagnose({ ratings, catalog: works });
    expect(d.recommendations.length).toBe(6);
    for (const r of d.recommendations) expect(r.work.source?.name).toBe("メディア芸術データベース");
  });
});
