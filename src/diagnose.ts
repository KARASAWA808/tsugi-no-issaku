import type { Media, Work } from "./catalog";

export interface Recommendation {
  work: Work;
  /** 「好き」と選んだ作品か☆5の作品のうち、いちばんタグが重なる1作 */
  from: Work;
  /** from と共通するタグ */
  shared: string[];
  score: number;
}

export interface Diagnosis {
  typeName: string;
  summary: string;
  /** 好みの強い順のタグ(最大5つ) */
  tags: string[];
  recommendations: Recommendation[];
}

export interface DiagnoseInput {
  picked: Work[];
  passed: Work[];
  /** ☆5を付けた作品。「好き」と同じ重みで好みに数え、おすすめには出さない */
  favorites?: Work[];
  catalog: Work[];
  /** 空ならすべての種類から選ぶ */
  media?: ReadonlySet<Media>;
  count?: number;
}

/** 選ばなかった作品のタグは少しだけ減点する */
const PASSED_TAG_WEIGHT = -0.3;
/** 設問で選ばれなかった作品そのものは、おすすめに出にくくする */
const PASSED_WORK_PENALTY = 3;

export function tagScores(picked: Work[], passed: Work[]): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (tag: string, n: number) => scores.set(tag, (scores.get(tag) ?? 0) + n);
  picked.forEach((w) => w.tags.forEach((t) => add(t, 1)));
  passed.forEach((w) => w.tags.forEach((t) => add(t, PASSED_TAG_WEIGHT)));
  return scores;
}

export function diagnose({ picked, passed, favorites = [], catalog, media, count = 6 }: DiagnoseInput): Diagnosis {
  // 設問に☆5の作品がまざることもあるので、二重に数えず、選ばなくても減点しない
  const liked = [...new Set([...picked, ...favorites])];
  const passedOnly = passed.filter((w) => !favorites.includes(w));
  const usedFavorites = favorites.some((w) => !picked.includes(w));
  const scores = tagScores(liked, passedOnly);
  const top = [...scores.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const recommendations = catalog
    .filter((w) => !liked.includes(w) && (!media?.size || media.has(w.media)))
    .flatMap((work): Recommendation[] => {
      let from: Work | null = null;
      let shared: string[] = [];
      for (const p of liked) {
        const common = work.tags.filter((t) => p.tags.includes(t));
        if (common.length > shared.length) {
          from = p;
          shared = common;
        }
      }
      if (!from) return [];
      const score =
        work.tags.reduce((sum, t) => sum + (scores.get(t) ?? 0), 0) +
        shared.length -
        (passedOnly.includes(work) ? PASSED_WORK_PENALTY : 0);
      return [{ work, from, shared, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count);

  return {
    typeName: top.length > 1 ? `${top[0]}×${top[1]}派` : `${top[0] ?? "なんでも"}派`,
    summary: top.length
      ? `${usedFavorites ? (picked.length ? "「好き」と選んだ作品と☆5の作品" : "☆5を付けた作品") : "「好き」と選んだ作品"}には「${top.slice(0, 3).join("」「")}」の要素が強く出ています。同じ味わいを持つ作品を、種類をまたいで選びました。`
      : liked.length
        ? "好みの傾向がまだ読み取れませんでした。"
        : "「好き」と選んだ作品がなかったので、傾向を読み取れませんでした。",
    tags: top.slice(0, 5),
    recommendations,
  };
}
