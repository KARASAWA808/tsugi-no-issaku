import type { Work } from "./catalog";

/** 設問の最大数。作品が少ないとこれより短くなる */
export const TOTAL_QUESTIONS = 5;
export const OPTIONS_PER_QUESTION = 6;
/** 1回の診断で出す作品数の上限 */
export const WORKS_PER_QUIZ = TOTAL_QUESTIONS * OPTIONS_PER_QUESTION;

export interface Round {
  options: Work[];
}

export interface Quiz {
  /** これまでに出した設問。rounds[index] が今の設問 */
  rounds: Round[];
  index: number;
  /** この診断の設問数。作品が30作に満たないときは短くなる */
  total: number;
  /** まだ出していない作品 */
  pool: Work[];
  /** 最後の設問で「診断する」を押したか */
  done: boolean;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function draw(quiz: Quiz): Work[] {
  return quiz.pool.splice(0, OPTIONS_PER_QUESTION);
}

export function createQuiz(catalog: Work[], random: () => number = Math.random): Quiz {
  if (catalog.length === 0) throw new Error("設問に出せる作品がありません");
  const total = Math.min(TOTAL_QUESTIONS, Math.ceil(catalog.length / OPTIONS_PER_QUESTION));
  const quiz: Quiz = { rounds: [], index: 0, total, pool: shuffle(catalog, random), done: false };
  quiz.rounds.push({ options: draw(quiz) });
  return quiz;
}

export const currentRound = (quiz: Quiz): Round => quiz.rounds[quiz.index];

export const isLastQuestion = (quiz: Quiz): boolean => quiz.index + 1 >= quiz.total;

/** すべての設問に答え終えたか */
export const isDone = (quiz: Quiz): boolean => quiz.done;

/** 次の設問へ進む。最後の設問なら診断に入る。 */
export function next(quiz: Quiz): void {
  if (quiz.done) return;
  if (isLastQuestion(quiz)) {
    quiz.done = true;
    return;
  }
  quiz.index++;
  if (!quiz.rounds[quiz.index]) quiz.rounds.push({ options: draw(quiz) });
}

/** ひとつ前の設問へ。診断結果からは最後の設問へ戻る。 */
export function back(quiz: Quiz): void {
  if (quiz.done) {
    quiz.done = false;
    return;
  }
  if (quiz.index > 0) quiz.index--;
}

/** 今の設問より先にすでに出してある作品 */
const aheadWorks = (quiz: Quiz): Work[] => quiz.rounds.slice(quiz.index + 1).flatMap((r) => r.options);

/** 今の6作を入れ替えても、今の設問と残りの設問に6作ずつ配れるか */
export function canSwap(quiz: Quiz): boolean {
  const need = OPTIONS_PER_QUESTION * (quiz.total - quiz.index);
  return quiz.pool.length + aheadWorks(quiz).length >= need;
}

/**
 * 「6つとも知らない」: 今の6作を捨てて別の6作にする。
 * 先の設問は引き直しになり、そこに出ていた作品は山に戻す。
 */
export function swap(quiz: Quiz): boolean {
  if (!canSwap(quiz)) return false;
  // 戻した作品は山の後ろへ。入れ替え後の6作は、まだ出していない作品から引く
  quiz.pool.push(...aheadWorks(quiz));
  quiz.rounds.length = quiz.index;
  quiz.rounds.push({ options: draw(quiz) });
  return true;
}

/** これまでの設問に出した作品 */
export const shownWorks = (quiz: Quiz): Work[] => quiz.rounds.flatMap((r) => r.options);
