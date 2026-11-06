import type { Media, Work } from "./catalog";

export interface Recommendation {
  work: Work;
  /** 選んだ作品のうち、いちばんタグが重なる1作 */
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

export function diagnose({ picked, passed, catalog, media, count = 6 }: DiagnoseInput): Diagnosis {
  const scores = tagScores(picked, passed);
  const top = [...scores.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const recommendations = catalog
    .filter((w) => !picked.includes(w) && (!media?.size || media.has(w.media)))
    .flatMap((work): Recommendation[] => {
      let from: Work | null = null;
      let shared: string[] = [];
      for (const p of picked) {
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
        (passed.includes(work) ? PASSED_WORK_PENALTY : 0);
      return [{ work, from, shared, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count);

  return {
    typeName: top.length > 1 ? `${top[0]}×${top[1]}派` : `${top[0] ?? "なんでも"}派`,
    summary: top.length
      ? `選んだ作品には「${top.slice(0, 3).join("」「")}」の要素が強く出ています。同じ味わいを持つ作品を、種類をまたいで選びました。`
      : "好みの傾向がまだ読み取れませんでした。",
    tags: top.slice(0, 5),
    recommendations,
  };
}
