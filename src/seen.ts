import { keyOf, type Work } from "./catalog";
import { WORKS_PER_QUIZ, shuffle } from "./quiz";

export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/** 見た作品と自分の評価。キーは keyOf(作品名か、取り込んだ作品の ID) */
export type Seen = Map<string, Rating>;

const VERSION = 1;

const isRating = (n: unknown): n is Rating => RATINGS.includes(n as Rating);

/** 見た作品として評価を付ける。付け直しは上書き。key は keyOf(work) */
export function rate(seen: Seen, key: string, rating: Rating): void {
  if (!isRating(rating)) throw new Error("評価は1〜5です");
  seen.set(key, rating);
}

/** 見た作品の記録を取り消す */
export function unrate(seen: Seen, key: string): void {
  seen.delete(key);
}

export const ratingOf = (seen: Seen, work: Work): Rating | undefined => seen.get(keyOf(work));

export const unseenOf = (catalog: Work[], seen: Seen): Work[] => catalog.filter((w) => !seen.has(keyOf(w)));

/** 見た作品を評価の高い順に。同じ評価ならカタログ順。カタログにない作品名は出さない */
export function seenList(catalog: Work[], seen: Seen): { work: Work; rating: Rating }[] {
  return catalog
    .flatMap((work) => {
      const rating = seen.get(keyOf(work));
      return rating ? [{ work, rating }] : [];
    })
    .sort((a, b) => b.rating - a.rating);
}

export interface QuizCatalog {
  works: Work[];
  /** 見ていない作品が足りず、見た作品で埋めた数 */
  filled: number;
}

/**
 * 設問に使う作品。catalog は種類でしぼった後のもの。
 * 見た作品は除くが、1回の診断に足りないときだけ見た作品をまぜて埋める(付け直せる)。
 * しぼった種類の作品が30作に満たなければ、ある分だけになる。
 */
export function quizCatalog(catalog: Work[], seen: Seen, random: () => number = Math.random): QuizCatalog {
  const unseen = unseenOf(catalog, seen);
  const lack = Math.min(WORKS_PER_QUIZ, catalog.length) - unseen.length;
  if (lack <= 0) return { works: unseen, filled: 0 };
  const fill = shuffle(catalog.filter((w) => seen.has(keyOf(w))), random).slice(0, lack);
  return { works: unseen.concat(fill), filled: fill.length };
}

export function serialize(seen: Seen): string {
  return JSON.stringify({ version: VERSION, ratings: Object.fromEntries(seen) });
}

/** 保存していた文字列を読む。壊れていても例外は投げず、読めた分だけ返す */
export function parse(text: string | null | undefined): Seen {
  const seen: Seen = new Map();
  if (!text) return seen;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return seen;
  }
  const ratings = (data as { ratings?: unknown } | null)?.ratings;
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return seen;
  for (const [key, rating] of Object.entries(ratings)) {
    if (key && isRating(rating)) seen.set(key, rating);
  }
  return seen;
}
