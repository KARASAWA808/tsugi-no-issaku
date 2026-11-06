#!/usr/bin/env node
/**
 * TMDB(The Movie Database)から、日本で公開・配信されている映画とドラマを取り込む。
 *
 *   npm run import:tmdb              # 取得(.cache/tmdb/ に保存)→ 変換 → data/tmdb/ に書き出す
 *   npm run import:tmdb -- --offline # .cache/tmdb/ にあるものだけで変換し直す(対応表を直したときなど)
 *
 * 鍵: API リードアクセストークンはこのスクリプトでは扱わない。実行する環境(作業セッション)の
 *     プロキシが api.themoviedb.org への Authorization ヘッダーを付ける。ここでは仮の値を送るだけ。
 *     リポジトリにも GitHub Actions にも鍵は置かない。取り込みは CI では走らせない。
 *
 * 範囲:
 *   - 映画: discover/movie を region=JP、公開種別 2〜6(劇場・配信・パッケージ・TV)で引く。
 *           つまり「日本での公開日が TMDB に登録されている映画」。人気順で MAX_PAGES ページまで
 *   - ドラマ: discover/tv を (a) watch_region=JP で配信情報(JustWatch 提供)があるもの、
 *             (b) 制作国が日本のもの、の2つで引いて合わせる。人気順で MAX_PAGES ページまで
 *   - どちらも票数の少ないものと成人向けは除く。ドキュメンタリー・ニュース・リアリティ・トーク番組は除く。
 *     アニメのテレビシリーズは除く(日本のものはメディア芸術データベース側(アニメ)にある。海外のものは
 *     このサイトの「ドラマ」に合わない)。アニメ映画は手書きのカタログと同じく「映画」として入れる
 *   - 日本語の題名がない作品(TMDB が原題をそのまま返すもの)は、日本では公開されていないか
 *     なじみがないと見て除く(原語が日本語か、題名に日本語が含まれるものは残す)
 *   - 作品ごとに keywords も取り、ジャンルと合わせて18タグに対応づける(対応表は src/tagmap.ts)
 *
 * 出力(どれも読める JSON):
 *   data/tmdb/tagged.json            タグ付けできた作品だけ(サイトが読む)
 *   data/tmdb/summary.json           件数・判定に使った条件・取得日。規約上、取得から6か月以内に取り直す
 *   data/tmdb/unmapped-genres.json   対応表に当たらなかったジャンル語・キーワードの上位
 *   .cache/tmdb/works/movie.json, tv.json   取り込んだ全作品(未整備も含む)。リポジトリには入れない
 *
 * プロキシ経由の環境では NODE_USE_ENV_PROXY=1 を付けると HTTPS_PROXY を使う。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TAGS, tagsForGenres } from "../src/tagmap.ts";
import { titleKey } from "../src/imported.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache", "tmdb");
const OUT = path.join(ROOT, "data", "tmdb");
const WORKS_OUT = path.join(CACHE, "works");
const OFFLINE = process.argv.includes("--offline");
const API = "https://api.themoviedb.org/3";
/** discover の1ページは20件。TMDB は500ページまで */
const MAX_PAGES = Number(process.env.TMDB_MAX_PAGES ?? 250);
const CONCURRENCY = 6;
/** 最低限の票数。これより少ない作品は、人気順の深いページにある登録だけの作品なので取らない */
const MIN_VOTES = { movie: 10, tv: 10, tvJapan: 3 };
/** 手書きの作品と同じく、タグは最大4つ */
const MAX_TAGS = 4;

// ---------------------------------------------------------------- 取得
let lastRequest = 0;
async function get(endpoint, params, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest)) return JSON.parse(fs.readFileSync(dest, "utf8"));
  if (OFFLINE) throw new Error(`--offline ですが ${file} が .cache/tmdb にありません`);
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 6; attempt++) {
    // 全体で1秒に30回ほどまでに抑える(TMDB の目安は50回)
    const wait = lastRequest + 33 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    const res = await fetch(url, {
      // 鍵はプロキシが付ける。ここは形だけの仮の値
      headers: { Authorization: "Bearer proxy-injected", Accept: "application/json" },
    });
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get("retry-after") ?? 2 * (attempt + 1));
      console.error(`  HTTP ${res.status}。${retry}秒待って再試行します: ${endpoint}`);
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(json));
    return json;
  }
  throw new Error(`${endpoint}: 再試行しても取れませんでした`);
}

/** 並行して取る。順番は保つ */
async function mapLimit(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** discover を1ページ目から順に引く。結果がなくなるか MAX_PAGES で止める */
async function discover(type, name, params) {
  const first = await get(`/discover/${type}`, { ...params, page: 1 }, `discover/${name}/1.json`);
  const pages = Math.min(first.total_pages ?? 1, MAX_PAGES, 500);
  console.error(`discover ${name}: ${first.total_results} 件中、${pages} ページ(最大 ${pages * 20} 件)を取ります`);
  const rest = await mapLimit(
    Array.from({ length: pages - 1 }, (_, i) => i + 2),
    (page) => get(`/discover/${type}`, { ...params, page }, `discover/${name}/${page}.json`),
  );
  return [first, ...rest].flatMap((p) => p.results ?? []);
}

// ---------------------------------------------------------------- 変換
const COMMON = { language: "ja-JP", include_adult: "false", sort_by: "popularity.desc" };
const CONDITIONS = {
  movie: "discover/movie: region=JP かつ 日本での公開種別が 2〜6(劇場・配信・パッケージ・TV)のいずれか(release_dates の JP)。vote_count >= 10",
  tv: "discover/tv: (a) watch_region=JP で配信情報(JustWatch 提供)がある(定額・無料・広告・レンタル・購入のいずれか)、vote_count >= 10。(b) 制作国が日本、vote_count >= 3。(a)と(b)の和集合",
};

/** サイトに出さないジャンル(TMDB の ID) */
const EXCLUDED_GENRES = new Set([99 /* ドキュメンタリー */, 10763 /* News */, 10764 /* Reality */, 10767 /* Talk */]);
const ANIMATION = 16;

const hasJapanese = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s);

const yearOf = (s) => {
  const m = /^(\d{4})/.exec(s ?? "");
  return m ? Number(m[1]) : null;
};

function convert(results, type, genreNames, excluded) {
  const works = new Map();
  for (const r of results) {
    if (r.adult) continue;
    const genreIds = r.genre_ids ?? [];
    if (genreIds.some((g) => EXCLUDED_GENRES.has(g))) {
      excluded.genre++;
      continue;
    }
    // アニメのテレビシリーズは入れない(日本のものはメディア芸術データベースのアニメにある)
    if (type === "tv" && genreIds.includes(ANIMATION)) {
      excluded.animatedTv++;
      continue;
    }
    const title = ((type === "movie" ? r.title : r.name) || "").trim();
    const original = ((type === "movie" ? r.original_title : r.original_name) || "").trim();
    if (!title || title.length > 80) continue;
    // 日本語の題名がない(原題のまま)作品は、日本で公開されていないかなじみがないと見て入れない
    if (!hasJapanese(title) && title === original && r.original_language !== "ja") {
      excluded.noJapaneseTitle++;
      continue;
    }
    const id = `${type}:${r.id}`;
    if (works.has(id)) continue;
    works.set(id, {
      id,
      tmdbId: r.id,
      title,
      media: type === "movie" ? "映画" : "ドラマ",
      year: yearOf(type === "movie" ? r.release_date : r.first_air_date),
      genres: genreIds.map((g) => genreNames.get(g)).filter(Boolean),
      keywords: [],
      originalLanguage: r.original_language,
      popularity: r.popularity,
      votes: r.vote_count,
    });
  }
  return [...works.values()];
}

/** 同じ種類で題名がそろう作品は人気の高い方だけ残す(リメイクや同名作は別の作品だが、設問に出す手がかりがないので1つにする) */
function dedupe(works) {
  const byKey = new Map();
  for (const w of works) {
    const key = `${w.media}:${titleKey(w.title)}`;
    const prev = byKey.get(key);
    if (!prev || (w.popularity ?? 0) > (prev.popularity ?? 0)) byKey.set(key, w);
  }
  return [...byKey.values()];
}

async function main() {
  const genreNames = new Map();
  for (const type of ["movie", "tv"]) {
    const list = await get(`/genre/${type}/list`, { language: "ja-JP" }, `genre_${type}.json`);
    for (const g of list.genres) genreNames.set(g.id, g.name);
  }

  const excluded = { genre: 0, animatedTv: 0, noJapaneseTitle: 0 };
  const movies = convert(
    await discover("movie", "movie_jp_release", { ...COMMON, region: "JP", with_release_type: "2|3|4|5|6", "vote_count.gte": MIN_VOTES.movie }),
    "movie",
    genreNames,
    excluded,
  );
  const tvStreaming = await discover("tv", "tv_jp_watch", {
    ...COMMON, watch_region: "JP", with_watch_monetization_types: "flatrate|free|ads|rent|buy", "vote_count.gte": MIN_VOTES.tv,
  });
  const tvJapan = await discover("tv", "tv_jp_origin", { ...COMMON, with_origin_country: "JP", "vote_count.gte": MIN_VOTES.tvJapan });
  const tv = convert([...tvStreaming, ...tvJapan], "tv", genreNames, excluded);
  const all = dedupe([...movies, ...tv]);
  console.error(`映画 ${movies.length} 件、ドラマ ${tv.length} 件(重複を除いて ${all.length} 件)。keywords を取ります`);

  await mapLimit(all, async (w, i) => {
    const type = w.media === "映画" ? "movie" : "tv";
    try {
      const kw = await get(`/${type}/${w.tmdbId}/keywords`, {}, `keywords/${type}/${w.tmdbId}.json`);
      w.keywords = (kw.keywords ?? kw.results ?? []).map((k) => k.name);
    } catch (e) {
      console.error(`  keywords を取れませんでした: ${w.id} (${e.message})`);
    }
    if ((i + 1) % 500 === 0) console.error(`  keywords ${i + 1}/${all.length}`);
  });

  const out = all.map((w) => {
    const tags = tagsForGenres([...w.genres, ...w.keywords]).slice(0, MAX_TAGS);
    return { ...w, tags, status: tags.length ? "tagged" : "untagged" };
  });
  out.sort((a, b) => a.media.localeCompare(b.media, "ja") || (b.popularity ?? 0) - (a.popularity ?? 0));
  for (const t of out.flatMap((w) => w.tags)) if (!TAGS.includes(t)) throw new Error(`知らないタグ: ${t}`);

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORKS_OUT, { recursive: true });
  const lines = (list) => "[\n" + list.map((w) => "  " + JSON.stringify(w)).join(",\n") + "\n]\n";
  const today = new Date().toISOString().slice(0, 10);
  const summary = {
    source: "TMDB (https://www.themoviedb.org/) API v3",
    fetchedAt: today,
    refetchBy: new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10),
    conditions: CONDITIONS,
    maxPages: MAX_PAGES,
    excluded: {
      "ドキュメンタリー・ニュース・リアリティ・トーク": excluded.genre,
      "アニメのテレビシリーズ": excluded.animatedTv,
      "日本語の題名なし": excluded.noJapaneseTitle,
    },
    byMedia: {},
  };
  for (const [media, file] of [["映画", "movie.json"], ["ドラマ", "tv.json"]]) {
    const list = out.filter((w) => w.media === media);
    fs.writeFileSync(path.join(WORKS_OUT, file), lines(list));
    summary.byMedia[media] = {
      total: list.length,
      tagged: list.filter((w) => w.status === "tagged").length,
      untagged: list.filter((w) => w.status === "untagged").length,
    };
  }
  const tagged = out.filter((w) => w.status === "tagged")
    .map((w) => ({ id: w.id, title: w.title, media: w.media, year: w.year, tags: w.tags, source: "tmdb" }));
  fs.writeFileSync(path.join(OUT, "tagged.json"), lines(tagged));
  summary.tagged = tagged.length;
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  const missed = new Map();
  for (const w of out) for (const g of [...w.genres, ...w.keywords]) if (!tagsForGenres([g]).length) missed.set(g, (missed.get(g) ?? 0) + 1);
  const top = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 150);
  fs.writeFileSync(path.join(OUT, "unmapped-genres.json"), JSON.stringify(Object.fromEntries(top), null, 2) + "\n");

  console.error(JSON.stringify(summary, null, 2));
  console.error(`全作品(未整備を含む)は ${WORKS_OUT} に書きました`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
