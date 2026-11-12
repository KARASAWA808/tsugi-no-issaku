// 表示用の名前と、文章づくりで使う小さな道具。DOMには触れない。
import type { RankInfo, Role } from "./types";

/**
 * 評価役のキャラクター名。実在の配信者をモチーフにした非公式のパロディで、ご本人の発言・見解ではない。
 * 名前を出したくない場合は、この2つを書き換えるだけで別のキャラクターになる。
 */
export const CRITIC_NAME = "仮想らいじん";
/** 自己紹介で呼びかけるときの名前 */
export const CRITIC_CALL = "らいじんさん";

export const ROLE_LABELS: Record<Role, string> = {
  TOP: "トップ",
  JUNGLE: "ジャングル",
  MIDDLE: "ミッド",
  BOTTOM: "ADC",
  UTILITY: "サポート",
  UNKNOWN: "ロール未定",
};

const TIER_LABELS: Record<string, string> = {
  IRON: "アイアン",
  BRONZE: "ブロンズ",
  SILVER: "シルバー",
  GOLD: "ゴールド",
  PLATINUM: "プラチナ",
  EMERALD: "エメラルド",
  DIAMOND: "ダイヤ",
  MASTER: "マスター",
  GRANDMASTER: "グランドマスター",
  CHALLENGER: "チャレンジャー",
};
const DIVISIONS: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" };
const APEX = new Set(["MASTER", "GRANDMASTER", "CHALLENGER"]);

/** "ゴールド4" のような表記。未判定なら "ランク未判定" */
export function rankLabel(rank: RankInfo | null): string {
  if (!rank) return "ランク未判定";
  const tier = TIER_LABELS[rank.tier] ?? rank.tier;
  return APEX.has(rank.tier) ? tier : `${tier}${DIVISIONS[rank.division] ?? ""}`;
}

export const f1 = (n: number): string => n.toFixed(1);
export const pct = (n: number): string => String(Math.round(n * 100));

/** 同じ入力なら同じ文章になるようにする、種つきの乱数(mulberry32) */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.floor(rng() * list.length)];
}

/**
 * はっきり度(strength)つきの一覧から count 個を選ぶ。並びは元の順のまま返す。
 * variant が 0 なら上から順(いちばん目立つもの)。1 以上なら、はっきり度を重みにした抽選で、言い直すたびに顔ぶれが変わる。
 */
export function choose<T extends { strength: number }>(list: readonly T[], count: number, rng: () => number, variant: number): T[] {
  if (variant === 0 || list.length <= count) return list.slice(0, count);
  const pool = list.map((item, index) => ({ item, index, weight: item.strength + 0.25 }));
  const chosen: { item: T; index: number }[] = [];
  while (chosen.length < count && pool.length > 0) {
    let roll = rng() * pool.reduce((total, p) => total + p.weight, 0);
    let at = 0;
    while (at < pool.length - 1 && roll >= pool[at].weight) {
      roll -= pool[at].weight;
      at += 1;
    }
    chosen.push(...pool.splice(at, 1));
  }
  return chosen.sort((a, b) => a.index - b.index).map((c) => c.item);
}
