import type { Work } from "./catalog";

export const TOTAL_QUESTIONS = 10;
export const OPTIONS_PER_QUESTION = 3;

export interface Round {
  options: Work[];
  /** この設問で「好き」と選んだ作品。0〜3作 */
  picks: Work[];
}

export interface Quiz {
  /** これまでに出した設問。rounds[index] が今の設問 */
  rounds: Round[];
  index: number;
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
  if (catalog.length < TOTAL_QUESTIONS * OPTIONS_PER_QUESTION) {
    throw new Error(`カタログには最低 ${TOTAL_QUESTIONS * OPTIONS_PER_QUESTION} 作が必要です`);
  }
  const quiz: Quiz = { rounds: [], index: 0, pool: shuffle(catalog, random), done: false };
  quiz.rounds.push({ options: draw(quiz), picks: [] });
  return quiz;
}

export const currentRound = (quiz: Quiz): Round => quiz.rounds[quiz.index];

export const isLastQuestion = (quiz: Quiz): boolean => quiz.index + 1 >= TOTAL_QUESTIONS;

/** 10問すべてに答え終えたか */
export const isDone = (quiz: Quiz): boolean => quiz.done;

/** 今の設問で作品の「好き」を付けたり外したりする。設問は進まない。 */
export function toggle(quiz: Quiz, work: Work): void {
  const round = currentRound(quiz);
  if (!round.options.includes(work)) throw new Error("選択肢にない作品です");
  const at = round.picks.indexOf(work);
  if (at >= 0) round.picks.splice(at, 1);
  else round.picks.push(work);
}

export const isPicked = (quiz: Quiz, work: Work): boolean => currentRound(quiz).picks.includes(work);

/** 今の設問を確定して次へ進む。ひとつも選んでいなくてもよい。最後の設問なら診断に入る。 */
export function next(quiz: Quiz): void {
  if (quiz.done) return;
  if (isLastQuestion(quiz)) {
    quiz.done = true;
    return;
  }
  quiz.index++;
  if (!quiz.rounds[quiz.index]) quiz.rounds.push({ options: draw(quiz), picks: [] });
}

/** ひとつ前の設問へ。診断結果からは最後の設問へ戻る。 */
export function back(quiz: Quiz): void {
  if (quiz.done) {
    quiz.done = false;
    return;
  }
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
  quiz.rounds[quiz.index] = { options: draw(quiz), picks: [] };
  quiz.rounds.length = quiz.index + 1;
  return true;
}

export const pickedWorks = (quiz: Quiz): Work[] => quiz.rounds.flatMap((r) => r.picks);

export const passedWorks = (quiz: Quiz): Work[] =>
  quiz.rounds.flatMap((r) => r.options.filter((w) => !r.picks.includes(w)));
