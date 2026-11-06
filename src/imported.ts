// 拡張子付きなのは、取り込みスクリプトが Node から直接読むため
import { MEDIA, type Media, type Work } from "./catalog.ts";

/** 取り込み元。madb = メディア芸術データベース(漫画・アニメ・ゲーム)、tmdb = TMDB(映画・ドラマ) */
export type ImportSource = "madb" | "tmdb";

/**
 * 外部データベースから取り込んだ作品。data/madb/tagged.json と data/tmdb/tagged.json の1件。
 * scripts/import-madb.mjs と scripts/import-tmdb.mjs が書き出す。
 */
export interface ImportedEntry {
  /** 元データの ID。MADB は C12345、TMDB は movie:155 / tv:5920 のように種類を含む */
  id: string;
  title: string;
  media: Media;
  year: number | null;
  tags: string[];
  /** 取り込み元。古い MADB の生成物には入っていないので、なければ madb */
  source?: ImportSource;
  /** Wikipedia の言語版の数。知名度の目安(MADB だけ) */
  sitelinks?: number;
}

export const MADB_NAME = "メディア芸術データベース";
export const MADB_ID_URL = "https://mediaarts-db.artmuseums.go.jp/id/";
export const TMDB_NAME = "TMDB";
export const TMDB_URL = "https://www.themoviedb.org/";
/** 評価の保存キーに付ける接頭辞。出典ごとに分け、同じ作品でも出典が違えば別のキーになる */
export const MADB_KEY_PREFIX = "madb:";
export const TMDB_KEY_PREFIX = "tmdb:";

export const sourceOf = (e: ImportedEntry): ImportSource => e.source ?? "madb";

/** 出典の作品ページ。TMDB は movie:155 → /movie/155 */
export function sourceLink(e: ImportedEntry): { name: string; url: string } {
  if (sourceOf(e) === "tmdb") return { name: TMDB_NAME, url: TMDB_URL + e.id.replace(":", "/") };
  return { name: MADB_NAME, url: MADB_ID_URL + e.id };
}

/**
 * 版の違い(新装版、完全版、文庫版など)と表記ゆれをそろえて、同じ作品をまとめるためのキー。
 * 取り込みスクリプトの重複除去と、手書きの作品との重なりの判定に使う。
 */
export function titleKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[【[(（〔「『][^】\])）〕」』]*(版|edition|ed\.)[^】\])）〕」』]*[】\])）〕」』]/g, "")
    .replace(/(新装|完全|愛蔵|文庫|ワイド|復刻|完全復刻|特装|限定|カラー|新|改訂|豪華|保存|コミック|劇場|総集編|大判)版$/g, "")
    .replace(/[!！?？・･:：、。,，.．'’"”“\-‐−–—~〜～]/g, "");
}

const isMedia = (x: unknown): x is Media => MEDIA.includes(x as Media);

/** 読み込んだ JSON の1件が使える形か。壊れた件は捨てる */
export function isImportedEntry(x: unknown): x is ImportedEntry {
  const e = x as ImportedEntry | null;
  return !!e && typeof e === "object"
    && typeof e.id === "string" && e.id !== ""
    && typeof e.title === "string" && e.title !== ""
    && isMedia(e.media)
    && (e.source === undefined || e.source === "madb" || e.source === "tmdb")
    && Array.isArray(e.tags) && e.tags.length > 0 && e.tags.every((t) => typeof t === "string");
}

/** 取り込んだ1件を、設問とおすすめに使える Work にする。ひとことは独自に書くまで空 */
export function toWork(e: ImportedEntry): Work {
  const work: Work = {
    id: (sourceOf(e) === "tmdb" ? TMDB_KEY_PREFIX : MADB_KEY_PREFIX) + e.id,
    title: e.title,
    media: e.media,
    tags: e.tags,
    pitch: "",
    source: sourceLink(e),
  };
  if (e.year != null) work.year = e.year;
  return work;
}

/**
 * 手書きのカタログと重なる作品(同じ種類で題名がそろう)を除いて Work にする。
 * 手書きの方にはひとことと隠れた名作の印があるので、そちらを残す。
 */
export function mergeImported(handwritten: readonly Work[], entries: readonly unknown[]): Work[] {
  const taken = new Set(handwritten.map((w) => `${w.media}:${titleKey(w.title)}`));
  const ids = new Set<string>();
  const out: Work[] = [];
  for (const e of entries) {
    if (!isImportedEntry(e)) continue;
    const key = `${e.media}:${titleKey(e.title)}`;
    const work = toWork(e);
    if (taken.has(key) || ids.has(work.id!)) continue;
    taken.add(key);
    ids.add(work.id!);
    out.push(work);
  }
  return out;
}

/** 取り込んだ作品を読む。別ファイルにしてあるので、結果画面を出すまで読まずに済む。片方が読めなくても、読めた方は使う */
export async function loadImported(handwritten: readonly Work[]): Promise<Work[]> {
  const files = await Promise.allSettled([import("../data/madb/tagged.json"), import("../data/tmdb/tagged.json")]);
  const entries = files.flatMap((f) => (f.status === "fulfilled" ? (f.value.default as unknown[]) : []));
  if (files.every((f) => f.status === "rejected")) throw new Error("取り込んだ作品を読めませんでした");
  return mergeImported(handwritten, entries);
}
