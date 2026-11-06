#!/usr/bin/env node
/**
 * メディア芸術データベース(MADB)の一括データから、漫画・アニメ・ゲームの作品を取り込む。
 *
 *   npm run import            # ダウンロード(.cache/ に保存)→ 変換 → data/madb/ に書き出す
 *   npm run import -- --offline   # .cache/ にあるものだけで変換し直す(対応表を直したときなど)
 *
 * 元データ:
 *   - MADB データセット(文化庁 → 国立アートリサーチセンター)。自由な二次利用が可能。
 *     https://github.com/mediaarts-db/dataset  data/json-ld/*.zip(JSON-LD)
 *   - Wikidata(CC0)。ジャンル(P136)と日本語ラベル、サイトリンク数(知名度の目安)を、
 *     漫画・アニメのジャンルの補いに使う(MADB の漫画・アニメにはジャンル項目がない)。
 *     結び付け方は2段階: (1) MADB の ID(P7886)が同じ項目、(2) なければ、同じ種類(漫画シリーズ、
 *     テレビアニメ、アニメ映画、ゲーム)の項目のうち、正規化した題名がただ1つ一致するもの。
 *
 * 出力(どれも読める JSON):
 *   data/madb/manga.json, anime.json, game.json  取り込んだ全作品(未整備も含む)。1行1作品
 *   data/madb/tagged.json                        タグ付けできた作品だけ。サイトが読む
 *   data/madb/summary.json                       件数と元データの版
 *
 * ジャンル語 → タグの対応は src/tagmap.ts、題名の正規化は src/imported.ts(Node 22.18 以上なら型を外して直接読める)。
 * プロキシ経由の環境では NODE_USE_ENV_PROXY=1 を付けると HTTPS_PROXY を使う。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { TAGS, tagsForGenres } from "../src/tagmap.ts";
import { titleKey } from "../src/imported.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache", "madb");
const OUT = path.join(ROOT, "data", "madb");
const OFFLINE = process.argv.includes("--offline");
const UA = "tsugi-no-issaku-import/0.1 (https://github.com/KARASAWA808/tsugi-no-issaku)";

/** MADB データセットの取得元。main ブランチの data/ にある版(README の 1.1、2022年2月)を使う */
const MADB_REPO = "https://raw.githubusercontent.com/mediaarts-db/dataset/main/data/json-ld/";
const MADB_VERSION = "mediaarts-db/dataset main (ver1.1, 2022-02)";
/** 読む小分類。作品単位に近いコレクションだけ */
const SOURCES = [
  { file: "metadata_cm-col_cm104_json.zip", media: "漫画", kind: "マンガ単行本シリーズ" },
  { file: "metadata_an-col_an207_json.zip", media: "アニメ", kind: "アニメテレビレギュラーシリーズ" },
  { file: "metadata_an-col_an208_json.zip", media: "アニメ", kind: "アニメテレビ単発アニメシリーズ" },
  { file: "metadata_an-col_an210_json.zip", media: "アニメ", kind: "アニメ映画シリーズ" },
  { file: "metadata_gm-col_gm306_json.zip", media: "ゲーム", kind: "ゲーム作品" },
];

// ---------------------------------------------------------------- 取得
async function download(url, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest)) return dest;
  if (OFFLINE) throw new Error(`--offline ですが ${file} が .cache にありません`);
  console.error(`取得中: ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/** ZIP を読む最小限の実装(無圧縮と deflate だけ。MADB の zip はこれで足りる) */
function* unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("zip ではありません");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip の中央ディレクトリが読めません");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const lnameLen = buf.readUInt16LE(local + 26);
    const lextraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lnameLen + lextraLen;
    const raw = buf.subarray(start, start + csize);
    if (method === 0) yield { name, data: raw };
    else if (method === 8) yield { name, data: zlib.inflateRawSync(raw) };
    else throw new Error(`${name}: 圧縮方式 ${method} には対応していません`);
  }
}

// ---------------------------------------------------------------- Wikidata
async function sparql(query, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest)) return JSON.parse(fs.readFileSync(dest, "utf8"));
  if (OFFLINE) throw new Error(`--offline ですが ${file} が .cache にありません`);
  console.error(`Wikidata に問い合わせ中: ${file}`);
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 15000 * attempt));
    const res = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }),
    });
    if (res.ok) {
      const json = await res.json();
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(dest, JSON.stringify(json));
      return json;
    }
    last = `HTTP ${res.status}`;
    console.error(`  ${last}。待って再試行します`);
  }
  throw new Error(`Wikidata: ${last}`);
}

/**
 * MADB の ID(P7886)を持つ項目を、ID の先頭文字と桁数で分けて取る(一度に取ると時間切れになる)。
 * 返すのは id → { label, sitelinks, genres[] }
 */
async function fetchWikidata() {
  const rows = new Map();
  const bucket = (id) => rows.get(id) ?? rows.set(id, { label: "", sitelinks: 0, genres: [] }).get(id);
  // ID は C+数字か M+数字。桁数(1〜7)で分けると各クエリが小さくなる
  const parts = [];
  for (const prefix of ["C", "M"]) for (let digits = 1; digits <= 7; digits++) parts.push({ prefix, digits });
  for (const { prefix, digits } of parts) {
    const filter = `FILTER(REGEX(?id, "^${prefix}[0-9]{${digits}}$"))`;
    const base = await sparql(
      `SELECT ?id ?label ?sitelinks WHERE { ?item wdt:P7886 ?id . ${filter}
         OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label)="ja") }
         OPTIONAL { ?item wikibase:sitelinks ?sitelinks } }`,
      `wikidata_base_${prefix}${digits}.json`,
    );
    for (const b of base.results.bindings) {
      const r = bucket(b.id.value);
      if (b.label) r.label = b.label.value;
      if (b.sitelinks) r.sitelinks = Number(b.sitelinks.value);
    }
    const genres = await sparql(
      `SELECT ?id ?genre WHERE { ?item wdt:P7886 ?id . ${filter}
         ?item wdt:P136 ?g . ?g rdfs:label ?genre FILTER(LANG(?genre)="ja") }`,
      `wikidata_genre_${prefix}${digits}.json`,
    );
    for (const b of genres.results.bindings) {
      const r = bucket(b.id.value);
      if (!r.genres.includes(b.genre.value)) r.genres.push(b.genre.value);
    }
  }
  return rows;
}

/**
 * 種類ごとの Wikidata のクラス(P31)。この中の、ジャンルと日本語ラベルを持つ項目を取る。
 * 題名での結び付けは同じ種類の中だけで行う(漫画と、そのアニメ化作品を取り違えないため)。
 */
const WIKIDATA_CLASSES = {
  漫画: [{ cls: "Q21198342" }, { cls: "Q8274" }], // 漫画シリーズ、漫画
  アニメ: [
    // テレビアニメシリーズとアニメ映画は世界中の作品が入っていて重いので、日本の作品(P495)にしぼる
    { cls: "Q63952888", japanOnly: true },
    { cls: "Q20650540", japanOnly: true },
    { cls: "Q1107" }, // アニメ
    { cls: "Q220898" }, // OVA
    { cls: "Q11086742" }, // アニメシリーズ
  ],
  ゲーム: [{ cls: "Q7889" }], // コンピュータゲーム
};

/** 種類ごとに、正規化した題名 → 候補の項目 [{ item, label, sitelinks, genres[] }] */
async function fetchWikidataByTitle() {
  const byMedia = {};
  for (const [media, classes] of Object.entries(WIKIDATA_CLASSES)) {
    const items = new Map();
    for (const { cls, japanOnly } of classes) {
      const res = await sparql(
        `SELECT ?item ?label ?sitelinks ?genre WHERE {
           ?item wdt:P31 wd:${cls} ; wdt:P136 ?g .${japanOnly ? " ?item wdt:P495 wd:Q17 ." : ""}
           ?item rdfs:label ?label . FILTER(LANG(?label)="ja")
           ?g rdfs:label ?genre . FILTER(LANG(?genre)="ja")
           OPTIONAL { ?item wikibase:sitelinks ?sitelinks } }`,
        `wikidata_class_${cls}.json`,
      );
      for (const b of res.results.bindings) {
        const r = items.get(b.item.value) ?? items.set(b.item.value, { label: b.label.value, sitelinks: Number(b.sitelinks?.value ?? 0), genres: [] }).get(b.item.value);
        if (!r.genres.includes(b.genre.value)) r.genres.push(b.genre.value);
      }
    }
    const byTitle = new Map();
    for (const r of items.values()) {
      const key = titleKey(r.label);
      if (!key) continue;
      (byTitle.get(key) ?? byTitle.set(key, []).get(key)).push(r);
    }
    byMedia[media] = byTitle;
  }
  return byMedia;
}

/** 題名の候補が複数あるときは、サイトリンク数がただ1つ最大のものだけを採る。決められなければ結び付けない */
function pickByTitle(candidates) {
  if (!candidates?.length) return undefined;
  if (candidates.length === 1) return candidates[0];
  const sorted = candidates.slice().sort((a, b) => b.sitelinks - a.sitelinks);
  return sorted[0].sitelinks > sorted[1].sitelinks ? sorted[0] : undefined;
}

// ---------------------------------------------------------------- 変換
/** JSON-LD の値(文字列、言語付きオブジェクト、その配列)から、日本語の文字列を1つ取る */
function jaString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    for (const x of v) if (typeof x === "string") return x;
    for (const x of v) if (x && x["@language"] === "ja") return x["@value"];
    return "";
  }
  return v["@language"] === "ja-hrkt" ? "" : String(v["@value"] ?? "");
}

function strings(v) {
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list.flatMap((x) => (typeof x === "string" ? [x] : x && typeof x["@value"] === "string" ? [x["@value"]] : []));
}

const yearOf = (...values) => {
  for (const v of values) {
    const m = /(1[89]\d\d|20\d\d)/.exec(String(v ?? ""));
    if (m) return Number(m[1]);
  }
  return undefined;
};

/** 成人向け。サイトには出さない */
const ADULT = new Set(["アダルトゲーム", "ヘンタイ", "エッチ", "成人向け漫画", "成人向けアニメ", "アダルトアニメ", "ポルノ"]);

function convert(nodes, source) {
  const works = [];
  for (const n of nodes) {
    if (typeof n["@type"] !== "string" || !n.identifier) continue;
    // 「題名 : 完全版」のような版の表記は、同じ作品にまとめたあとの表示には要らないので落とす
    const title = (jaString(n.name) || jaString(n.label) || "").trim()
      .replace(/\s*[:：]\s*(新装|完全|愛蔵|文庫|ワイド|復刻|完全復刻|特装|限定|カラー|新|改訂|豪華|保存|大判)版$/, "");
    if (!title || title.length > 80) continue;
    const lang = jaString(n.inLanguage);
    if (lang && lang !== "日本語" && lang !== "複数言語") continue;
    const rating = strings(n.contentRating).join(",");
    const madbGenres = strings(n.keywords).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    const adult = /成年/.test(rating) || madbGenres.some((g) => ADULT.has(g));
    works.push({
      id: n.identifier,
      title,
      media: source.media,
      kind: source.kind,
      year: yearOf(n.datePublished, n.startDate, n.datePublishedFinal),
      madbGenres,
      adult,
    });
  }
  return works;
}

/**
 * 同じ作品(同じ種類で題名がそろう)をまとめる。
 * 題名・年・ID は年のいちばん古いもの(初版)から取り、Wikidata の情報(ジャンル、サイトリンク数)は
 * どの版に付いていても使う。ジャンルは版をまたいで合わせ、サイトリンク数はいちばん多いものにする。
 */
function dedupe(works) {
  const groups = new Map();
  for (const w of works) {
    const key = `${w.media}:${titleKey(w.title)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)).push(w);
  }
  const out = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id.localeCompare(b.id));
    const rep = { ...group[0] };
    rep.sitelinks = Math.max(...group.map((w) => w.sitelinks ?? 0));
    rep.wikidataGenres = [...new Set(group.flatMap((w) => w.wikidataGenres ?? []))];
    rep.madbGenres = [...new Set(group.flatMap((w) => w.madbGenres ?? []))];
    out.push(rep);
  }
  return out;
}

/** 手書きの作品と同じく、タグは最大4つ。元データのジャンル語の順(MADB の keywords → Wikidata)で先のものを残す */
const MAX_TAGS = 4;

async function main() {
  const wikidata = await fetchWikidata();
  console.error(`Wikidata: MADB の ID 付き ${wikidata.size} 件(ジャンルあり ${[...wikidata.values()].filter((r) => r.genres.length).length} 件)`);

  const all = [];
  const counts = {};
  for (const source of SOURCES) {
    const zipPath = await download(MADB_REPO + source.file, source.file);
    let nodes = [];
    for (const entry of unzip(fs.readFileSync(zipPath))) {
      if (!entry.name.endsWith(".json")) continue;
      nodes = nodes.concat(JSON.parse(entry.data.toString("utf8"))["@graph"]);
    }
    const works = convert(nodes, source);
    counts[source.kind] = works.length;
    for (const w of works) all.push(w);
  }

  const byTitle = await fetchWikidataByTitle();
  let matchedById = 0;
  let matchedByTitle = 0;
  for (const w of all) {
    let wd = wikidata.get(w.id);
    if (wd) matchedById++;
    else {
      wd = pickByTitle(byTitle[w.media]?.get(titleKey(w.title)));
      if (wd) matchedByTitle++;
    }
    if (!wd) continue;
    w.sitelinks = wd.sitelinks;
    w.wikidataGenres = wd.genres;
    if (wd.genres.some((g) => ADULT.has(g))) w.adult = true;
  }
  console.error(`Wikidata と結び付いた作品: ID で ${matchedById} 件、題名で ${matchedByTitle} 件`);

  const kept = dedupe(all.filter((w) => !w.adult));
  const excludedAdult = all.filter((w) => w.adult).length;

  const out = kept.map((w) => {
    const genres = [...new Set([...(w.madbGenres ?? []), ...(w.wikidataGenres ?? [])])];
    const tags = tagsForGenres(genres).slice(0, MAX_TAGS);
    return {
      id: w.id,
      title: w.title,
      media: w.media,
      kind: w.kind,
      year: w.year ?? null,
      genres,
      tags,
      sitelinks: w.sitelinks ?? 0,
      status: tags.length ? "tagged" : "untagged",
    };
  });
  out.sort((a, b) => a.media.localeCompare(b.media, "ja") || (a.year ?? 9999) - (b.year ?? 9999) || a.id.localeCompare(b.id));

  for (const t of out.flatMap((w) => w.tags)) {
    if (!TAGS.includes(t)) throw new Error(`知らないタグ: ${t}`);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const lines = (list) => "[\n" + list.map((w) => "  " + JSON.stringify(w)).join(",\n") + "\n]\n";
  const files = { 漫画: "manga.json", アニメ: "anime.json", ゲーム: "game.json" };
  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    source: MADB_VERSION,
    wikidata: `Wikidata (${today} 取得)`,
    generatedAt: today,
    excludedAdult,
    wikidataMatched: { byId: matchedById, byTitle: matchedByTitle },
    byKind: counts,
    byMedia: {},
  };
  for (const [media, file] of Object.entries(files)) {
    const list = out.filter((w) => w.media === media);
    fs.writeFileSync(path.join(OUT, file), lines(list));
    summary.byMedia[media] = {
      total: list.length,
      tagged: list.filter((w) => w.status === "tagged").length,
      untagged: list.filter((w) => w.status === "untagged").length,
      withGenres: list.filter((w) => w.genres.length).length,
    };
  }
  // サイトが読む分。未整備は入れず、項目も最小限にして軽くする
  const tagged = out.filter((w) => w.status === "tagged").map((w) => ({ id: w.id, title: w.title, media: w.media, year: w.year, tags: w.tags, sitelinks: w.sitelinks }));
  fs.writeFileSync(path.join(OUT, "tagged.json"), lines(tagged));
  summary.tagged = tagged.length;
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  // 対応表に当たらなかったジャンル語の上位。対応表を育てるための参考
  const missed = new Map();
  for (const w of out) for (const g of w.genres) if (!tagsForGenres([g]).length) missed.set(g, (missed.get(g) ?? 0) + 1);
  const top = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 60);
  fs.writeFileSync(path.join(OUT, "unmapped-genres.json"), JSON.stringify(Object.fromEntries(top), null, 2) + "\n");

  console.error(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
