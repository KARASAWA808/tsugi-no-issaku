import "./style.css";
import { CATALOG, MEDIA, type Media, type Work } from "./catalog";
import { diagnose } from "./diagnose";
import {
  TOTAL_QUESTIONS, back, canSwap, createQuiz, currentRound, isDone, isLastQuestion, isPicked,
  next, passedWorks, pickedWorks, swap, toggle, type Quiz,
} from "./quiz";
import {
  RATINGS, parse, quizCatalog, rate, ratingOf, seenList, serialize, unrate, unseenOf, type Rating, type Seen,
} from "./seen";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---- 見た作品の保存(このブラウザの localStorage)。使えない環境ではメモリだけで動く ----
const STORAGE_KEY = "tsugi-no-issaku:seen";
let storageOk = true;

function loadSeen(): Seen {
  try {
    return parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    storageOk = false;
    return new Map();
  }
}

function saveSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(seen));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

const seen = loadSeen();
let quiz: Quiz;
/** おすすめのカードで評価したときの一言。カードはすぐ消えるので、ここで保存を知らせる */
let rateMessage = "";
const mediaFilter = new Set<Media>();

/** 描き直しても、押していたボタンにフォーカスを戻す */
function keepFocus(render: () => void) {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.key;
  render();
  if (key) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

/** 評価が変わったら、今の画面と見た作品の一覧を描き直す */
function onSeenChange() {
  saveSeen();
  keepFocus(() => {
    if (!$("quiz").hidden) renderQuestion();
    if (!$("result").hidden) renderResult();
    renderSeen();
  });
}

/**
 * ☆5つの評価ボタン。scope は同じ作品が画面の複数か所に出るときにフォーカスを区別するため。
 * 今の評価と同じ☆を押すと評価を外せる(設問と一覧で使う)。
 */
function stars(work: Work, scope: string, opts: { clearable: boolean }) {
  const current = ratingOf(seen, work);
  const row = el("span", "stars");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", `『${work.title}』の評価`);
  for (const n of RATINGS) {
    const b = el("button", "star" + (current && n <= current ? " on" : ""), current && n <= current ? "★" : "☆");
    b.type = "button";
    b.dataset.key = `${scope}:${work.title}:${n}`;
    b.setAttribute("aria-label", `星${n}`);
    b.setAttribute("aria-pressed", String(current === n));
    b.onclick = () => {
      if (opts.clearable && current === n) unrate(seen, work.title);
      else rate(seen, work.title, n as Rating);
      if (scope === "pop") rateMessage = `『${work.title}』を星${n}で見た作品に入れました。付け直しや取り消しは下の「見た作品」からできます。`;
      onSeenChange();
    };
    row.append(b);
  }
  return row;
}

// ---- 設問 ----
function start() {
  rateMessage = "";
  const { works, filled } = quizCatalog(CATALOG, seen);
  quiz = createQuiz(works);
  const note = $("quizNote");
  note.hidden = filled === 0;
  note.textContent = `まだ見ていない作品が少ないので、見た作品も${filled}作まぜています。`;
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
    const wrap = el("div", "opt-wrap");
    const b = el("button", "opt");
    b.type = "button";
    b.dataset.key = `opt:${work.title}`;
    b.setAttribute("aria-pressed", String(isPicked(quiz, work)));
    b.append(el("span", "kind", work.media), el("span", "name", work.title), el("span", "sub", work.pitch));
    b.onclick = () => {
      toggle(quiz, work);
      b.setAttribute("aria-pressed", String(isPicked(quiz, work)));
      renderNext();
    };
    const rateRow = el("div", "rate");
    rateRow.append(el("span", "rate-label", ratingOf(seen, work) ? "見た" : "見たなら"), stars(work, "q", { clearable: true }));
    wrap.append(b, rateRow);
    options.append(wrap);
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

// ---- 診断結果 ----
function renderResult() {
  const picked = pickedWorks(quiz);
  const d = diagnose({ picked, passed: passedWorks(quiz), catalog: unseenOf(CATALOG, seen), media: mediaFilter });

  $("typeName").textContent = d.typeName;
  $("typeSummary").textContent = d.summary;
  $("typeTags").replaceChildren(...d.tags.map((t) => el("span", "tag", t)));

  const status = $("status");
  status.hidden = d.recommendations.length > 0;
  status.className = "status err";
  status.textContent = picked.length === 0
    ? "「好き」と選んだ作品がないので、おすすめを出せませんでした。「選び直す」から、気になる作品をひとつでも選んでみてください。"
    : mediaFilter.size
      ? "この種類で、まだ見ていない作品は見つかりませんでした。しぼりこみを外してください。"
      : "まだ見ていない作品の中に、好みに合うものが見つかりませんでした。";

  $("shelf").replaceChildren(
    ...d.recommendations.map(({ work, from, shared }) => {
      const card = el("article", "pop");
      const top = el("div", "pop-top");
      top.append(el("span", "media", work.media));
      const rateRow = el("div", "pop-rate");
      rateRow.append(el("span", undefined, "もう見た?"), stars(work, "pop", { clearable: false }));
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
        rateRow,
        foot,
      );
      return card;
    }),
  );

  $("rateNote").textContent = rateMessage;

  $("picks").textContent = picked.length
    ? `あなたが「好き」と選んだ${picked.length}作: ` + picked.map((w) => `『${w.title}』`).join(" ")
    : "「好き」と選んだ作品はありませんでした。";
}

// ---- 見た作品の一覧 ----
function renderSeen() {
  const list = seenList(CATALOG, seen);
  $("seenCount").textContent = `${list.length}作`;
  $("seenEmpty").hidden = list.length > 0;
  const warn = $("seenWarn");
  warn.hidden = storageOk;
  warn.textContent = "このブラウザでは保存できないため、ページを閉じると評価が消えます。";

  $("seenList").replaceChildren(
    ...list.map(({ work }) => {
      const li = el("li");
      const name = el("span", "seen-name");
      name.append(el("span", "kind", work.media), el("span", undefined, work.title));
      const undo = el("button", "btn btn-quiet btn-small", "取り消す");
      undo.type = "button";
      undo.dataset.key = `undo:${work.title}`;
      undo.setAttribute("aria-label", `『${work.title}』を見た作品から外す`);
      undo.onclick = () => { unrate(seen, work.title); onSeenChange(); };
      li.append(name, stars(work, "list", { clearable: false }), undo);
      return li;
    }),
  );
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

renderSeen();
start();
