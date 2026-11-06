import type { Work } from "./catalog";
import type { Rating } from "./seen";

export interface Rated {
  work: Work;
  rating: Rating;
}

export interface Recommendation {
  work: Work;
  /** ☆4以上を付けた作品のうち、いちばんタグが重なる1作(同じなら評価の高い方) */
  from: Work;
  fromRating: Rating;
  /** from と共通するタグ */
  shared: string[];
  score: number;
  /** 「気になる」を付けている作品か。付けていればカードに印を出す */
  interested: boolean;
}

export interface Diagnosis {
  typeName: string;
  summary: string;
  /** 好みの強い順のタグ(最大5つ) */
  tags: string[];
  recommendations: Recommendation[];
}

export interface DiagnoseInput {
  /** 自分で付けた☆評価。診断はこれだけを使う */
  ratings: Rated[];
  /** おすすめを選ぶ作品。種類やジャンルでしぼるときは、しぼってから渡す */
  catalog: Work[];
  /** 「気になる」を付けた作品。タグを弱い手がかりとして足すだけで、おすすめの元にはしない */
  interested?: Work[];
  count?: number;
}

/** ☆ごとのタグの重み。☆3はどちらでもない、☆1〜2は好みから遠ざける */
export const RATING_WEIGHT: Record<Rating, number> = { 5: 1, 4: 0.5, 3: 0, 2: -0.5, 1: -1 };
/** この評価以上の作品を「好き」として、おすすめの元にする */
export const LIKED_RATING = 4;
/** 「気になる」を付けた作品のタグの重み。まだ見ていないので、☆4と同じ弱い手がかりとして数える */
export const INTEREST_WEIGHT = 0.5;

export function tagScores(ratings: Rated[], interested: Work[] = []): Map<string, number> {
  const scores = new Map<string, number>();
  for (const { work, rating } of ratings) {
    for (const t of work.tags) scores.set(t, (scores.get(t) ?? 0) + RATING_WEIGHT[rating]);
  }
  for (const work of interested) {
    for (const t of work.tags) scores.set(t, (scores.get(t) ?? 0) + INTEREST_WEIGHT);
  }
  return scores;
}

export function diagnose({ ratings, catalog, interested = [], count = 6 }: DiagnoseInput): Diagnosis {
  // 同じ作品が2回来たら後の評価を使う
  const byWork = new Map(ratings.map((r) => [r.work, r.rating] as const));
  const rated = [...byWork].map(([work, rating]) => ({ work, rating }));
  // ☆を付けた作品は見たことになるので、「気になる」に残っていても☆の方だけを使う
  const wanted = new Set(interested.filter((w) => !byWork.has(w)));
  const scores = tagScores(rated, [...wanted]);
  const top = [...scores.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
  // 評価の高い順に並べておくと、重なりが同じとき☆5が元に選ばれる
  const liked = rated.filter((r) => r.rating >= LIKED_RATING).sort((a, b) => b.rating - a.rating);

  const recommendations = catalog
    .filter((w) => !byWork.has(w))
    .flatMap((work): Recommendation[] => {
      let best: Rated | null = null;
      let shared: string[] = [];
      for (const r of liked) {
        const common = work.tags.filter((t) => r.work.tags.includes(t));
        if (common.length > shared.length) {
          best = r;
          shared = common;
        }
      }
      if (!best) return [];
      const score = work.tags.reduce((sum, t) => sum + (scores.get(t) ?? 0), 0) + shared.length;
      return [{ work, from: best.work, fromRating: best.rating, shared, score, interested: wanted.has(work) }];
    })
    // 同点なら「気になる」を付けた作品を先に出す
    .sort((a, b) => b.score - a.score || Number(b.interested) - Number(a.interested))
    .slice(0, count);

  return {
    typeName: liked.length && top.length
      ? top.length > 1 ? `${top[0]}×${top[1]}派` : `${top[0]}派`
      : "まだ見えない派",
    summary: !rated.length
      ? "☆を付けた作品がなかったので、傾向を読み取れませんでした。"
      : !liked.length
        ? "☆4以上を付けた作品がまだないので、好みの傾向を読み取れませんでした。"
        : !top.length
          ? "高く評価した作品と低く評価した作品の要素が打ち消し合っていて、好みの傾向を読み取れませんでした。高く評価した作品に近いものを選びました。"
          : `高く評価した作品には「${top.slice(0, 3).join("」「")}」の要素が強く出ています。同じ味わいを持つ作品を、種類をまたいで選びました。`,
    tags: liked.length ? top.slice(0, 5) : [],
    recommendations,
  };
}
