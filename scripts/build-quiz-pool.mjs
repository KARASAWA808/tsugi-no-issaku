#!/usr/bin/env node
/**
 * 設問に出す候補 data/quiz-pool.json を作る。
 *
 *   npm run quiz-pool
 *
 * 設問は「見たことがあるか」を答えるものなので、取り込んだ作品のうち知られているものを種類ごとに上位だけ選ぶ。
 *   - TMDB(映画・ドラマ・アニメ): popularity の高い順
 *   - メディア芸術データベース(漫画・ゲーム・アニメ): Wikidata のサイトリンク数(Wikipedia の言語版の数)の多い順
 * 手書きの作品と同じ種類・同じ題名のものと、出典どうしで重なるもの(同じアニメなら TMDB を使う)は除く。
 * 読むのは data/madb/tagged.json と data/tmdb/*.json だけなので、.cache/ がなくても作り直せる。
 * ページを開いたときに読むファイルなので、150KB 前後に収まる件数にしている。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../src/catalog.ts";
import { isImportedEntry, sourceOf, titleKey } from "../src/imported.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "quiz-pool.json");

/** 種類ごとの件数の上限 */
export const POOL_SIZE = { 漫画: 220, アニメ: 220, ゲーム: 200, 映画: 220, ドラマ: 220 };

const read = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", file), "utf8"));
const entries = [...read("madb/tagged.json"), ...read("tmdb/tagged.json"), ...read("tmdb/anime.json")].filter(isImportedEntry);

// src/imported.ts の mergeImported と同じ規則で重なりを除く(手書き優先、出典どうしは TMDB 優先)
const taken = new Set(CATALOG.map((w) => `${w.media}:${titleKey(w.title)}`));
const ordered = [...entries.filter((e) => sourceOf(e) === "tmdb"), ...entries.filter((e) => sourceOf(e) !== "tmdb")];
const unique = [];
for (const e of ordered) {
  const key = `${e.media}:${titleKey(e.title)}`;
  if (taken.has(key)) continue;
  taken.add(key);
  unique.push(e);
}

/** 知名度の目安。出典ごとに尺度が違うので、並べるのは同じ出典の中だけ */
const fame = (e) => (sourceOf(e) === "tmdb" ? e.popularity ?? 0 : e.sitelinks ?? 0);

/**
 * 種類の中に出典が2つあるとき(アニメ)は、出典ごとに知名度順に並べた列を、件数に応じた割合で交互に取る。
 * 尺度の違う popularity とサイトリンク数を直接くらべない
 */
function pick(list, size) {
  const bySource = new Map();
  for (const e of list) (bySource.get(sourceOf(e)) ?? bySource.set(sourceOf(e), []).get(sourceOf(e))).push(e);
  const queues = [...bySource.values()].map((q) => ({ items: q.sort((a, b) => fame(b) - fame(a)), taken: 0 }));
  const out = [];
  while (out.length < size) {
    const open = queues.filter((q) => q.taken < q.items.length);
    if (!open.length) break;
    // 消費した割合がいちばん小さい出典から取る → 件数に比例した割合になる
    const q = open.reduce((a, b) => (a.taken / a.items.length <= b.taken / b.items.length ? a : b));
    out.push(q.items[q.taken++]);
  }
  return out;
}

const pool = [];
const counts = {};
for (const [media, size] of Object.entries(POOL_SIZE)) {
  const list = pick(unique.filter((e) => e.media === media), size);
  counts[media] = { total: list.length, tmdb: list.filter((e) => sourceOf(e) === "tmdb").length, madb: list.filter((e) => sourceOf(e) !== "tmdb").length };
  for (const e of list) pool.push({ id: e.id, title: e.title, media: e.media, year: e.year, tags: e.tags, source: sourceOf(e) });
}

const text = "[\n" + pool.map((w) => "  " + JSON.stringify(w)).join(",\n") + "\n]\n";
fs.writeFileSync(OUT, text);
console.error(JSON.stringify({ total: pool.length, bytes: Buffer.byteLength(text), byMedia: counts }, null, 2));
