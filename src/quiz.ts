import type { Work } from "./catalog";

export const TOTAL_QUESTIONS = 10;
export const OPTIONS_PER_QUESTION = 3;

export interface Round {
  options: Work[];
  pick: Work | null;
}

export interface Quiz {
  /** これまでに出した設問。rounds[index] が今の設問 */
  rounds: Round[];
  index: number;
  /** まだ出していない作品 */
  pool: Work[];
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
  if (catalog.length < TOTAL_QUESTIONS * OPTIONS_PER_QUESTION) {
    throw new Error(`カタログには最低 ${TOTAL_QUESTIONS * OPTIONS_PER_QUESTION} 作が必要です`);
  }
  const quiz: Quiz = { rounds: [], index: 0, pool: shuffle(catalog, random) };
  quiz.rounds.push({ options: draw(quiz), pick: null });
  return quiz;
}

export const currentRound = (quiz: Quiz): Round => quiz.rounds[quiz.index];

/** 10問すべてに答え終えたか */
export const isDone = (quiz: Quiz): boolean =>
  quiz.rounds.length === TOTAL_QUESTIONS && quiz.rounds.every((r) => r.pick !== null);

/** 今の設問で作品を選び、次の設問へ進む。最後の設問ならその場にとどまる。 */
export function choose(quiz: Quiz, work: Work): void {
  const round = currentRound(quiz);
  if (!round.options.includes(work)) throw new Error("選択肢にない作品です");
  round.pick = work;
  if (quiz.index + 1 >= TOTAL_QUESTIONS) return;
  quiz.index++;
  if (!quiz.rounds[quiz.index]) quiz.rounds.push({ options: draw(quiz), pick: null });
}

export function back(quiz: Quiz): void {
  if (quiz.index > 0) quiz.index--;
}

/** 今の3作を入れ替えても、残りの設問に3作ずつ配れるか */
export function canSwap(quiz: Quiz): boolean {
  const remaining = TOTAL_QUESTIONS - quiz.index;
  const alreadyDrawnAhead = quiz.rounds.length - quiz.index - 1;
  return quiz.pool.length >= OPTIONS_PER_QUESTION * (remaining - alreadyDrawnAhead);
}

/** 「3つとも知らない」: 今の3作を捨てて別の3作にする。先の設問は引き直しになる。 */
export function swap(quiz: Quiz): boolean {
  if (!canSwap(quiz)) return false;
  quiz.rounds[quiz.index] = { options: draw(quiz), pick: null };
  quiz.rounds.length = quiz.index + 1;
  return true;
}

export const pickedWorks = (quiz: Quiz): Work[] =>
  quiz.rounds.flatMap((r) => (r.pick ? [r.pick] : []));

export const passedWorks = (quiz: Quiz): Work[] =>
  quiz.rounds.flatMap((r) => r.options.filter((w) => w !== r.pick));
