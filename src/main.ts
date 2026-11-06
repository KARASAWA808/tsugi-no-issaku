import "./style.css";
import { CATALOG, MEDIA, type Media, type Work } from "./catalog";
import { diagnose } from "./diagnose";
import {
  TOTAL_QUESTIONS, back, canSwap, choose, createQuiz, currentRound, isDone,
  passedWorks, pickedWorks, swap, type Quiz,
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
    const b = el("button", "opt" + (round.pick === work ? " picked" : ""));
    b.type = "button";
    b.append(el("span", "kind", work.media), el("span", "name", work.title), el("span", "sub", work.pitch));
    b.onclick = () => onChoose(work);
    options.append(b);
  }

  $<HTMLButtonElement>("backBtn").disabled = quiz.index === 0;
  const ok = canSwap(quiz);
  $<HTMLButtonElement>("swapBtn").disabled = !ok;
  $("swapHint").textContent = ok
    ? "知らない作品ばかりなら、別の3作に入れ替えられます。"
    : "入れ替えられる作品がもうありません。気になる方を選んでください。";
}

function onChoose(work: Work) {
  choose(quiz, work);
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
  status.textContent = "この種類の作品はカタログにありませんでした。しぼりこみを外してください。";

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
      foot.append(el("span", undefined, `『${from.title}』を選んだあなたへ`), link);
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

  $("picks").textContent = "あなたが選んだ10作: " + picked.map((w) => `『${w.title}』`).join(" ");
}

$("backBtn").onclick = () => { back(quiz); renderQuestion(); };
$("swapBtn").onclick = () => { if (swap(quiz)) renderQuestion(); };
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
