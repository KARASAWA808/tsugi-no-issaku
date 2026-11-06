import { keyOf, type Work } from "./catalog";
import { rate, type Rating, type Seen } from "./seen";

/** 「気になる」を付けた作品。まだ見ていないが興味がある作品のキー(keyOf)の集まり */
export type Interest = Set<string>;

const VERSION = 1;

/** 気になるを付ける。すでに付いていれば何もしない。key は keyOf(work) */
export function mark(interest: Interest, key: string): void {
  if (key) interest.add(key);
}

/** 気になるを外す */
export function unmark(interest: Interest, key: string): void {
  interest.delete(key);
}

/** 付いていれば外し、付いていなければ付ける。付けたら true */
export function toggle(interest: Interest, key: string): boolean {
  if (interest.has(key)) {
    unmark(interest, key);
    return false;
  }
  mark(interest, key);
  return true;
}

export const isInterested = (interest: Interest, work: Work): boolean => interest.has(keyOf(work));

/**
 * ☆を付けると見た作品になるので、「気になる」は自動で外す。
 * 逆に「気になる」を付けても☆は変えない(toggle は seen に触れない)。
 */
export function rateAndClear(seen: Seen, interest: Interest, key: string, rating: Rating): void {
  rate(seen, key, rating);
  unmark(interest, key);
}

/** 気になる作品をカタログ順に。カタログにないキーは出さない */
export function interestList(catalog: Work[], interest: Interest): Work[] {
  return catalog.filter((w) => interest.has(keyOf(w)));
}

export function serializeInterest(interest: Interest): string {
  return JSON.stringify({ version: VERSION, titles: [...interest] });
}

/** 保存していた文字列を読む。壊れていても例外は投げず、読めた分だけ返す */
export function parseInterest(text: string | null | undefined): Interest {
  const interest: Interest = new Set();
  if (!text) return interest;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return interest;
  }
  const titles = (data as { titles?: unknown } | null)?.titles;
  if (!Array.isArray(titles)) return interest;
  for (const title of titles) {
    if (typeof title === "string" && title) interest.add(title);
  }
  return interest;
}
