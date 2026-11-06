import type { Media, Work } from "./catalog";

/** 気分で選ぶジャンル。中身は既存の好みタグのまとまり */
export interface Mood {
  name: string;
  tags: string[];
}

export const MOODS: Mood[] = [
  { name: "泣ける", tags: ["感動", "切なさ"] },
  { name: "考えさせられる", tags: ["哲学"] },
  { name: "ハラハラする", tags: ["サスペンス", "頭脳戦"] },
  { name: "謎を解きたい", tags: ["ミステリー"] },
  { name: "笑える", tags: ["笑い"] },
  { name: "癒やされる", tags: ["日常"] },
  { name: "胸が熱くなる", tags: ["成長", "仲間"] },
  { name: "ワクワクする", tags: ["冒険", "バトル"] },
  { name: "ときめく", tags: ["恋愛"] },
  { name: "別世界に浸る", tags: ["世界観", "ファンタジー", "SF"] },
];

export interface Filter {
  /** 診断する種類。1つ以上 */
  media: ReadonlySet<Media>;
  /** 気分のジャンル名。空ならすべてのジャンル。複数選んだらどれかに当たればよい */
  moods: ReadonlySet<string>;
  /** 隠れた名作だけにする(おすすめだけに使う) */
  gemsOnly?: boolean;
}

export function matchesMood(work: Work, moods: ReadonlySet<string>): boolean {
  if (moods.size === 0) return true;
  return MOODS.some((m) => moods.has(m.name) && m.tags.some((t) => work.tags.includes(t)));
}

export function matches(work: Work, filter: Filter): boolean {
  return filter.media.has(work.media) && matchesMood(work, filter.moods) && (!filter.gemsOnly || work.gem === true);
}
