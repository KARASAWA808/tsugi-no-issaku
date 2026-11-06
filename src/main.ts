import "./style.css";
import { CATALOG, MEDIA, type Media } from "./catalog";
import { diagnose } from "./diagnose";
import {
  TOTAL_QUESTIONS, back, canSwap, createQuiz, currentRound, isDone, isLastQuestion, isPicked,
  next, passedWorks, pickedWorks, swap, toggle, type Quiz,
} from "./quiz";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

let quiz: Quiz;
const mediaFilter = new Set<Media>();

function start() {
  quiz = createQuiz(CATALOG);
  showQuiz();
}

function showQuiz() {
  $("result").hidden = true;
  $("quiz").hidden = false;
  renderQuestion();
}

function renderQuestion() {
  const round = currentRound(quiz);
  $("qnum").replaceChildren(`Q${quiz.index + 1}`, el("small", undefined, ` / ${TOTAL_QUESTIONS}`));

  const steps = $("steps");
  steps.replaceChildren();
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    steps.append(el("i", i < quiz.index ? "done" : i === quiz.index ? "now" : ""));
  }

  const options = $("options");
  options.replaceChildren();
  for (const work of round.options) {
    const b = el("button", "opt");
    b.type = "button";
    b.setAttribute("aria-pressed", String(isPicked(quiz, work)));
    b.append(el("span", "kind", work.media), el("span", "name", work.title), el("span", "sub", work.pitch));
    b.onclick = () => {
      toggle(quiz, work);
      b.setAttribute("aria-pressed", String(isPicked(quiz, work)));
      renderNext();
    };
    options.append(b);
  }

  renderNext();
  $<HTMLButtonElement>("backBtn").disabled = quiz.index === 0;
  const ok = canSwap(quiz);
  $<HTMLButtonElement>("swapBtn").disabled = !ok;
  $("swapHint").textContent = ok
    ? "知らない作品ばかりなら、別の3作に入れ替えられます。"
    : "入れ替えられる作品がもうありません。知らなければ選ばずに進んでください。";
}

/** 選んだ数に合わせて「次へ」ボタンの文言を変える */
function renderNext() {
  const n = currentRound(quiz).picks.length;
  const last = isLastQuestion(quiz);
  $("nextBtn").textContent = last
    ? "診断する"
    : n === 0 ? "好きなものはない" : `${n}作を選んで次へ`;
}

function onNext() {
  next(quiz);
  if (isDone(quiz)) {
    $("quiz").hidden = true;
    $("result").hidden = false;
    window.scrollTo({ top: 0 });
    renderResult();
  } else {
    renderQuestion();
  }
}

function renderResult() {
  const picked = pickedWorks(quiz);
  const d = diagnose({ picked, passed: passedWorks(quiz), catalog: CATALOG, media: mediaFilter });

  $("typeName").textContent = d.typeName;
  $("typeSummary").textContent = d.summary;
  $("typeTags").replaceChildren(...d.tags.map((t) => el("span", "tag", t)));

  const status = $("status");
  status.hidden = d.recommendations.length > 0;
  status.className = "status err";
  status.textContent = picked.length === 0
    ? "「好き」と選んだ作品がないので、おすすめを出せませんでした。「選び直す」から、気になる作品をひとつでも選んでみてください。"
    : "この種類の作品はカタログにありませんでした。しぼりこみを外してください。";

  $("shelf").replaceChildren(
    ...d.recommendations.map(({ work, from, shared }) => {
      const card = el("article", "pop");
      const top = el("div", "pop-top");
      top.append(el("span", "media", work.media));
      const foot = el("div", "pop-foot");
      const link = el("a", undefined, "作品を調べる");
      link.href = "https://www.google.com/search?q=" + encodeURIComponent(`${work.title} ${work.media}`);
      link.target = "_blank";
      link.rel = "noopener";
      foot.append(el("span", undefined, `『${from.title}』が好きなあなたへ`), link);
      card.append(
        top,
        el("p", "pitch", work.pitch),
        el("h3", undefined, `『${work.title}』`),
        el("p", "reason", `『${from.title}』と同じく「${shared.join("」「")}」を味わえる作品です。`),
        foot,
      );
      return card;
    }),
  );

  $("picks").textContent = picked.length
    ? `あなたが「好き」と選んだ${picked.length}作: ` + picked.map((w) => `『${w.title}』`).join(" ")
    : "「好き」と選んだ作品はありませんでした。";
}

$("nextBtn").onclick = onNext;
$("backBtn").onclick = () => { back(quiz); renderQuestion(); };
$("swapBtn").onclick = () => { if (swap(quiz)) renderQuestion(); };
$("fixBtn").onclick = () => { back(quiz); showQuiz(); };
$("retryBtn").onclick = start;

for (const m of MEDIA) {
  const b = el("button", "toggle", m);
  b.type = "button";
  b.setAttribute("aria-pressed", "false");
  b.onclick = () => {
    const on = !mediaFilter.has(m);
    if (on) mediaFilter.add(m); else mediaFilter.delete(m);
    b.setAttribute("aria-pressed", String(on));
    renderResult();
  };
  $("mediaList").append(b);
}

start();
