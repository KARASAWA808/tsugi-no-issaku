// 評価役の「口ぐせ」を、組み立てた評価文の前後に差し込む。DOMには触れない。
// 口ぐせは2か所から集める:
//   1. この下の BUILTIN_PHRASES(出典を確かめられたものだけを、出典つきで置く)
//   2. 手元にだけ置く lol/public/local/phrases.json(git 管理外。自分で聞いたことのある言い回しを足す場所)
// 評価の中身(数字へのツッコミ)は自動で組み立てたもので、ご本人の発言ではない。口ぐせは言い回しを借りているだけ。

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
}

export type PhraseBook = Record<Slot, Phrase[]>;

export const emptyBook = (): PhraseBook => ({
  opening: [], accept: [], reject: [], roast: [], verdictHigh: [], verdictLow: [], homework: [],
});

/** 1つの言い回しの長さと、1つの場所に置ける数の上限(手元のファイルが壊れていても画面が崩れないように) */
const MAX_LENGTH = 80;
const MAX_PER_SLOT = 60;

function parsePhrase(item: unknown): Phrase | null {
  const raw = typeof item === "string" ? { text: item } : item;
  if (typeof raw !== "object" || raw === null) return null;
  const { text, after } = raw as { text?: unknown; after?: unknown };
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return null;
  return after === true ? { text: trimmed, after: true } : { text: trimmed };
}

/**
 * phrases.json の中身を PhraseBook にする。形の合わないところは黙って捨てる。
 * 各場所は、文字列か `{ "text": "...", "after": true }` の配列。
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
 * 評価文に口ぐせを付ける関数を作る。
 * 多く使うほどそれらしくなるので、口ぐせがある場所では毎回付ける。同じ言い回しは、ひととおり使い切るまで繰り返さない。
 */
export function makeSpeaker(book: PhraseBook, rng: () => number, name: string): (slot: Slot, line: string) => string {
  const queues = new Map<Slot, Phrase[]>();
  const used = new Set<string>();

  const next = (slot: Slot): Phrase | null => {
    if (book[slot].length === 0) return null;
    let queue = queues.get(slot);
    if (!queue || queue.length === 0) {
      // 使い切ったら、並べ直してもう一巡
      queue = [...book[slot]];
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      queues.set(slot, queue);
    }
    // 別の場所でもう使った言い回しは、ほかに残っていれば後回しにする
    const fresh = queue.findIndex((p) => !used.has(p.text));
    const [phrase] = queue.splice(fresh === -1 ? 0 : fresh, 1);
    used.add(phrase.text);
    return phrase;
  };

  return (slot, line) => {
    const phrase = next(slot);
    if (!phrase) return line;
    const text = phrase.text.replaceAll("{name}", name);
    if (phrase.after) return `${line}${text}`;
    return `${text}${ENDS_SENTENCE.test(text) ? "" : "。"}${line}`;
  };
}

/**
 * コードに入れておく口ぐせ。出典を確かめられたものだけを置き、出典をコメントに書く。
 * 確かめられないものは入れない(言っていないことを「言った」ことにしないため)。
 */
export const BUILTIN_PHRASES: PhraseBook = emptyBook();
