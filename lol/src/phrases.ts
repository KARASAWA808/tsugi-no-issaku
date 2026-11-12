// 評価役の「口ぐせ」を、組み立てた評価文の前後に差し込む。DOMには触れない。
// 口ぐせは2か所から集める:
//   1. この下の BUILTIN_PHRASES(出典を確かめられたものだけを、出典つきで置く)
//   2. 手元にだけ置く lol/public/local/phrases.json(git 管理外。自分で聞いたことのある言い回しを足す場所)
// 評価の中身(数字へのツッコミ)は自動で組み立てたもので、ご本人の発言ではない。口ぐせは言い回しを借りているだけ。
import type { Role } from "./types";

/** 口ぐせを入れる場所 */
export type Slot =
  /** 評価の最初のひとこと */
  | "opening"
  /** 自己紹介を「認める」とき */
  | "accept"
  /** 自己紹介を「却下」するとき */
  | "reject"
  /** 自己紹介になかった弱みを指摘するとき */
  | "roast"
  /** 総評(S・A のとき) */
  | "verdictHigh"
  /** 総評(B・C・D のとき) */
  | "verdictLow"
  /** 次の宿題を出すとき */
  | "homework";

export const SLOTS: readonly Slot[] = ["opening", "accept", "reject", "roast", "verdictHigh", "verdictLow", "homework"];

export interface Phrase {
  /** 言い回し。`{name}` はプレイヤー名に置きかわる */
  text: string;
  /** true なら評価文のあとに付ける。なければ前に付ける */
  after?: boolean;
  /** 書くと、メインロールがこれの人にだけ使う(「TOPレーナーとして…」のようなロール限定の言い回し用) */
  role?: Role;
}

export type PhraseBook = Record<Slot, Phrase[]>;

export const emptyBook = (): PhraseBook => ({
  opening: [], accept: [], reject: [], roast: [], verdictHigh: [], verdictLow: [], homework: [],
});

/** 1つの言い回しの長さと、1つの場所に置ける数の上限(手元のファイルが壊れていても画面が崩れないように) */
const MAX_LENGTH = 80;
const MAX_PER_SLOT = 60;
const ROLES: readonly string[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

function parsePhrase(item: unknown): Phrase | null {
  const raw = typeof item === "string" ? { text: item } : item;
  if (typeof raw !== "object" || raw === null) return null;
  const { text, after, role } = raw as { text?: unknown; after?: unknown; role?: unknown };
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return null;
  const phrase: Phrase = { text: trimmed };
  if (after === true) phrase.after = true;
  if (role !== undefined) {
    // ロールの書きまちがいは、全員に出てしまわないよう捨てる
    if (typeof role !== "string" || !ROLES.includes(role)) return null;
    phrase.role = role as Role;
  }
  return phrase;
}

/**
 * phrases.json の中身を PhraseBook にする。形の合わないところは黙って捨てる。
 * 各場所は、文字列か `{ "text": "...", "after": true, "role": "TOP" }` の配列。
 */
export function parsePhrases(input: unknown): PhraseBook {
  const book = emptyBook();
  if (typeof input !== "object" || input === null) return book;
  for (const slot of SLOTS) {
    const list = (input as Record<string, unknown>)[slot];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const phrase = parsePhrase(item);
      if (phrase && book[slot].length < MAX_PER_SLOT) book[slot].push(phrase);
    }
  }
  return book;
}

/** 複数の PhraseBook を合わせる。同じ場所の同じ言い回しは1つにする */
export function mergePhrases(...books: readonly PhraseBook[]): PhraseBook {
  const merged = emptyBook();
  for (const slot of SLOTS) {
    const seen = new Set<string>();
    for (const book of books) {
      for (const phrase of book[slot]) {
        if (seen.has(phrase.text)) continue;
        seen.add(phrase.text);
        merged[slot].push(phrase);
      }
    }
  }
  return merged;
}

export const countPhrases = (book: PhraseBook): number => SLOTS.reduce((total, slot) => total + book[slot].length, 0);

const ENDS_SENTENCE = /[。!?!?…、,〜ー♪)」』]$/;

/**
 * 評価文に口ぐせを付ける関数を作る(1回の評価につき1つ作る)。
 * 多く使うほどそれらしくなるので、口ぐせがある場所では毎回付ける。
 * ただし同じ言い回しは1回の評価で1度だけ。使い切った場所には何も付けない(同じ台詞が並ぶと嘘くさくなる)。
 */
export function makeSpeaker(
  book: PhraseBook,
  rng: () => number,
  name: string,
  role: Role = "UNKNOWN",
): (slot: Slot, line: string) => string {
  const used = new Set<string>();

  return (slot, line) => {
    // 別の場所でもう使った言い回しも、ここでは使わない
    const fresh = book[slot].filter((p) => (p.role === undefined || p.role === role) && !used.has(p.text));
    if (fresh.length === 0) return line;
    // ロール限定の言い回しは出番が少ないので、使えるときは先に使う
    const limited = fresh.filter((p) => p.role !== undefined);
    const pool = limited.length > 0 ? limited : fresh;
    const phrase = pool[Math.floor(rng() * pool.length)];
    used.add(phrase.text);
    const text = phrase.text.replaceAll("{name}", name);
    if (phrase.after) return `${line}${text}`;
    return `${text}${ENDS_SENTENCE.test(text) ? "" : "。"}${line}`;
  };
}

/**
 * コードに入れておく口ぐせ。出典を確かめられたものだけを置き、出典をコメントに書く。
 * 確かめられないものは入れない(言っていないことを「言った」ことにしないため)。
 *
 * 確かめ方の水準(2026年11月の調査。作業環境から元ページの本文は開けず、検索結果で確かめた):
 *   [題]   記事・クリップの題にその文言がそのまま出ている。表記は題のとおり
 *   [要約] 2回の別の検索で同じ文言が引用された。題ではないので、表記は元の動画で確かめ直す余地がある
 * 元は特定の相手に向けた発言でも、ここでは相手の名前を外し、プレイの内容にだけ向けて使う。
 * 暴言や、揉め事に由来する発言、ほかの人の発言は入れない。
 */
// [題] LTK スクリムのフィードバック https://fistbump-news.jp/article/2025/06/20/1181.html
// トップの人にだけ、却下・追加の指摘・総評のどこかで1度だけ出す
const TOP_LANER: Phrase = { text: "TOPレーナーとしてどうかと思う。", after: true, role: "TOP" };

export const BUILTIN_PHRASES: PhraseBook = {
  opening: [],
  accept: [
    // [題] LTK でサポートを評価した場面 https://fistbump-news.jp/article/2025/07/30/1378.html
    { text: "最も替えたくなかったのがサポートだった。", role: "UTILITY" },
  ],
  reject: [
    // [要約] LTK の練習中、コーチとして。公式の日めくりカレンダーにも収録とされる https://kai-you.net/article/93541
    { text: "おい話聞いてんのか。" },
    // [題] 特訓の切り抜きの題 https://www.youtube.com/watch?v=rbzfZWJdwbQ
    { text: "下手だね。" },
    TOP_LANER,
  ],
  roast: [TOP_LANER],
  verdictHigh: [],
  verdictLow: [
    // [題] 打ち上げの最終フィードバックで、笑いながら https://fistbump-news.jp/article/2025/09/10/1554.html
    { text: "このチーム弱ｗ" },
    // [題] カスタムでの一言。代表的な名言として紹介されている https://kai-you.net/article/93541
    { text: "俺が3人いたら勝てる。", after: true },
    TOP_LANER,
  ],
  homework: [
    // [要約] LTK での助言 https://www.youtube.com/watch?v=bV1YgEaybWM
    { text: "負けてる時のことは考えなくていいから、負けるな。", after: true },
  ],
};
