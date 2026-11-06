// 拡張子付きなのは、取り込みスクリプトが Node から直接読むため
import { MEDIA, type Media, type Work } from "./catalog.ts";

/**
 * 外部データベース(いまはメディア芸術データベース)から取り込んだ作品。
 * data/madb/tagged.json の1件。scripts/import-madb.mjs が書き出す。
 */
export interface ImportedEntry {
  /** 元データの ID(例: C12345) */
  id: string;
  title: string;
  media: Media;
  year: number | null;
  tags: string[];
  /** Wikipedia の言語版の数。知名度の目安 */
  sitelinks: number;
}

export const MADB_NAME = "メディア芸術データベース";
export const MADB_ID_URL = "https://mediaarts-db.artmuseums.go.jp/id/";
/** 評価の保存キーに付ける接頭辞 */
export const MADB_KEY_PREFIX = "madb:";

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
    && Array.isArray(e.tags) && e.tags.length > 0 && e.tags.every((t) => typeof t === "string");
}

/** 取り込んだ1件を、設問とおすすめに使える Work にする。ひとことは独自に書くまで空 */
export function toWork(e: ImportedEntry): Work {
  const work: Work = {
    id: MADB_KEY_PREFIX + e.id,
    title: e.title,
    media: e.media,
    tags: e.tags,
    pitch: "",
    source: { name: MADB_NAME, url: MADB_ID_URL + e.id },
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
    if (taken.has(key) || ids.has(e.id)) continue;
    taken.add(key);
    ids.add(e.id);
    out.push(toWork(e));
  }
  return out;
}

/** 取り込んだ作品を読む。別ファイルにしてあるので、結果画面を出すまで読まずに済む */
export async function loadImported(handwritten: readonly Work[]): Promise<Work[]> {
  const mod = await import("../data/madb/tagged.json");
  return mergeImported(handwritten, mod.default as unknown[]);
}
