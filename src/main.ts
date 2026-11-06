import "./style.css";
import { CATALOG, MEDIA, type Media, type Work } from "./catalog";
import { LIKED_RATING, diagnose } from "./diagnose";
import { MOODS, matches, type Filter } from "./filter";
import {
  TOTAL_QUESTIONS, back, canSwap, createQuiz, currentRound, isDone, isLastQuestion, next, shownWorks, swap,
  type Quiz,
} from "./quiz";
import {
  RATINGS, parse, quizCatalog, rate, ratingOf, seenList, serialize, unrate, type Rating, type Seen,
} from "./seen";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---- このブラウザの localStorage への保存。使えない環境ではメモリだけで動く ----
const SEEN_KEY = "tsugi-no-issaku:seen";
const MEDIA_KEY = "tsugi-no-issaku:media";
const MOODS_KEY = "tsugi-no-issaku:moods";
let storageOk = true;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    storageOk = false;
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

/** 保存していた「診断する種類」。読めないか空なら全種類 */
function loadMedia(): Set<Media> {
  try {
    const list = JSON.parse(load(MEDIA_KEY) ?? "[]");
    const valid = Array.isArray(list) ? list.filter((m): m is Media => MEDIA.includes(m)) : [];
    return new Set(valid.length ? valid : MEDIA);
  } catch {
    return new Set(MEDIA);
  }
}

/** 保存していたジャンル。読めなければ指定なし(すべて) */
function loadMoods(): Set<string> {
  try {
    const list = JSON.parse(load(MOODS_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((m) => MOODS.some((x) => x.name === m)) : []);
  } catch {
    return new Set();
  }
}

const seen: Seen = parse(load(SEEN_KEY));
const media = loadMedia();
const moods = loadMoods();
/** 結果画面で種類やジャンルを変えたら、設問に戻るときに出し直す */
let quizStale = false;
/** 条件に合う作品がないときは null。そのあいだ設問のボタンは押せない */
let quiz: Quiz | null = null;
/** おすすめのカードで評価したときの一言。カードはすぐ消えるので、ここで保存を知らせる */
let rateMessage = "";

const filterOf = (gemsOnly = false): Filter => ({ media, moods, gemsOnly });

/** 描き直しても、押していたボタンにフォーカスを戻す */
function keepFocus(render: () => void) {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.key;
  render();
  if (key) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

/** 評価が変わったら、今の画面と見た作品の一覧を描き直す */
function onSeenChange() {
  store(SEEN_KEY, serialize(seen));
  keepFocus(() => {
    if (!$("quiz").hidden) renderQuestion();
    if (!$("result").hidden) renderResult();
    renderSeen();
  });
}

/**
 * ☆5つの評価ボタン。scope は同じ作品が画面の複数か所に出るときにフォーカスを区別するため。
 * 今の評価と同じ☆を押すと評価を外せる(設問で使う)。
 */
function stars(work: Work, scope: string, opts: { clearable: boolean }) {
  const current = ratingOf(seen, work);
  const row = el("span", "stars");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", `『${work.title}』の評価`);
  for (const n of RATINGS) {
    const on = current !== undefined && n <= current;
    const b = el("button", "star" + (on ? " on" : ""), on ? "★" : "☆");
    b.type = "button";
    b.dataset.key = `${scope}:${work.title}:${n}`;
    b.setAttribute("aria-label", `星${n}`);
    b.setAttribute("aria-pressed", String(current === n));
    b.onclick = () => {
      if (opts.clearable && current === n) unrate(seen, work.title);
      else rate(seen, work.title, n as Rating);
      if (scope === "pop") {
        rateMessage = `『${work.title}』を星${n}で見た作品に入れました。診断にもすぐ反映しています。付け直しや取り消しは下の「見た作品」からできます。`;
      }
      onSeenChange();
    };
    row.append(b);
  }
  return row;
}

// ---- 診断する種類とジャンルのチェック ----
function checkbox(label: string, checked: boolean, onChange: (input: HTMLInputElement) => void) {
  const wrap = el("label", "check");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.onchange = () => onChange(input);
  wrap.append(input, el("span", undefined, label));
  return wrap;
}

function renderFilter() {
  $("mediaChecks").replaceChildren(...MEDIA.map((m) => checkbox(m, media.has(m), (input) => onMediaChange(m, input))));
  $("moodChecks").replaceChildren(...MOODS.map(({ name }) => checkbox(name, moods.has(name), (input) => {
    if (input.checked) moods.add(name); else moods.delete(name);
    store(MOODS_KEY, JSON.stringify([...moods]));
    afterFilterChange();
  })));
}

const MEDIA_NOTE = "1つ以上選んでください。複数選べます。";

function onMediaChange(m: Media, input: HTMLInputElement) {
  const note = $("mediaNote");
  if (!input.checked && media.size === 1) {
    input.checked = true;
    note.textContent = "最後の1つは外せません。ほかの種類を選んでから外してください。";
    note.classList.add("warn");
    return;
  }
  note.textContent = MEDIA_NOTE;
  note.classList.remove("warn");
  if (input.checked) media.add(m); else media.delete(m);
  store(MEDIA_KEY, JSON.stringify([...media]));
  afterFilterChange();
}

/** 結果画面ではおすすめだけを選び直し、設問の途中なら出し直す */
function afterFilterChange() {
  if (!$("result").hidden) {
    quizStale = true;
    renderResult();
  } else {
    start();
  }
}

// ---- 設問 ----
function start() {
  rateMessage = "";
  quizStale = false;
  const { works, filled } = quizCatalog(CATALOG.filter((w) => matches(w, filterOf())), seen);
  if (works.length === 0) {
    quiz = null;
    showEmptyQuiz();
    return;
  }
  quiz = createQuiz(works);
  const notes = [];
  if (quiz.total < TOTAL_QUESTIONS) notes.push(`選んだ種類やジャンルの作品が少ないので、設問は${quiz.total}問です。`);
  if (filled) notes.push(`まだ評価していない作品が少ないので、評価済みの作品も${filled}作まぜています。☆を付け直せます。`);
  const note = $("quizNote");
  note.hidden = notes.length === 0;
  note.textContent = notes.join("");
  showQuiz();
}

/** 条件に合う作品がひとつもないとき。設問を出さずに理由だけ見せる */
function showEmptyQuiz() {
  $("result").hidden = true;
  $("quiz").hidden = false;
  $("qnum").textContent = "";
  $("steps").replaceChildren();
  $("options").replaceChildren();
  const note = $("quizNote");
  note.hidden = false;
  note.textContent = "選んだ条件に合う作品がありません。診断する種類やジャンルを増やしてください。";
  for (const id of ["nextBtn", "backBtn", "swapBtn"]) $<HTMLButtonElement>(id).disabled = true;
  $("swapHint").textContent = "";
}

function showQuiz() {
  $("result").hidden = true;
  $("quiz").hidden = false;
  renderQuestion();
}

function renderQuestion() {
  if (!quiz) return;
  const round = currentRound(quiz);
  $("qnum").replaceChildren(`Q${quiz.index + 1}`, el("small", undefined, ` / ${quiz.total}`));

  const steps = $("steps");
  steps.style.setProperty("--n", String(quiz.total));
  steps.replaceChildren();
  for (let i = 0; i < quiz.total; i++) {
    steps.append(el("i", i < quiz.index ? "done" : i === quiz.index ? "now" : ""));
  }

  $("options").replaceChildren(
    ...round.options.map((work) => {
      const rated = ratingOf(seen, work) !== undefined;
      const card = el("div", "opt" + (rated ? " rated" : ""));
      const rateRow = el("div", "rate");
      rateRow.append(el("span", "rate-label", rated ? "見た" : "見たなら"), stars(work, "q", { clearable: true }));
      card.append(el("span", "kind", work.media), el("span", "name", work.title), el("span", "sub", work.pitch), rateRow);
      return card;
    }),
  );

  const n = round.options.filter((w) => ratingOf(seen, w) !== undefined).length;
  $<HTMLButtonElement>("nextBtn").disabled = false;
  $("nextBtn").textContent = isLastQuestion(quiz)
    ? "診断する"
    : n === 0 ? "見た作品はない" : `${n}作を評価して次へ`;
  $<HTMLButtonElement>("backBtn").disabled = quiz.index === 0;
  const ok = canSwap(quiz);
  $<HTMLButtonElement>("swapBtn").disabled = !ok;
  $("swapHint").textContent = ok
    ? "知らない作品ばかりなら、別の6作に入れ替えられます。"
    : "入れ替えられる作品がもうありません。見ていなければ、そのまま次へ進んでください。";
}

function onNext() {
  if (!quiz) return;
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
  const ratings = seenList(CATALOG, seen);
  const likedCount = ratings.filter((r) => r.rating >= LIKED_RATING).length;
  const gemsOnly = $<HTMLInputElement>("gemsOnly").checked;
  const d = diagnose({ ratings, catalog: CATALOG.filter((w) => matches(w, filterOf(gemsOnly))), count: 6 });

  $("typeName").textContent = d.typeName;
  $("typeSummary").textContent = d.summary;
  $("typeTags").replaceChildren(...d.tags.map((t) => el("span", "tag", t)));

  const status = $("status");
  status.hidden = d.recommendations.length > 0;
  status.className = "status err";
  status.textContent = ratings.length === 0
    ? "☆を付けた作品がないので、おすすめを出せませんでした。「設問に戻る」から、見た作品に☆を付けてください。"
    : likedCount === 0
      ? "☆4以上を付けた作品がないので、おすすめを出せませんでした。好きだった作品に☆4〜5を付けてみてください。"
      : gemsOnly
        ? "選んだ種類やジャンルの隠れた名作で、まだ評価していないものの中に好みに合う作品が見つかりませんでした。「隠れた名作だけ」を外すか、種類やジャンルを増やしてみてください。"
        : "選んだ種類やジャンルで、まだ評価していない作品の中に好みに合うものが見つかりませんでした。種類やジャンルを増やしてみてください。";

  $("shelf").replaceChildren(
    ...d.recommendations.map(({ work, from, fromRating, shared }) => {
      const card = el("article", "pop");
      const top = el("div", "pop-top");
      top.append(el("span", "media", work.media));
      if (work.gem) top.append(el("span", "surprise", "隠れた名作"));
      const rateRow = el("div", "pop-rate");
      rateRow.append(el("span", undefined, "もう見た?"), stars(work, "pop", { clearable: false }));
      const foot = el("div", "pop-foot");
      const link = el("a", undefined, "作品を調べる");
      link.href = "https://www.google.com/search?q=" + encodeURIComponent(`${work.title} ${work.media}`);
      link.target = "_blank";
      link.rel = "noopener";
      foot.append(el("span", undefined, `『${from.title}』に☆${fromRating}を付けたあなたへ`), link);
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
  const thisTime = (quiz ? shownWorks(quiz) : []).filter((w) => ratingOf(seen, w) !== undefined).length;
  $("picks").textContent = ratings.length
    ? `☆を付けた${ratings.length}作から診断しました。今回の設問で評価したのは${thisTime}作です。`
    : "☆を付けた作品はまだありません。";
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
$("backBtn").onclick = () => { if (quiz) { back(quiz); renderQuestion(); } };
$("swapBtn").onclick = () => { if (quiz && swap(quiz)) renderQuestion(); };
$("fixBtn").onclick = () => {
  if (!quiz || quizStale) start();
  else { back(quiz); showQuiz(); }
};
$("gemsOnly").onchange = renderResult;
$("retryBtn").onclick = start;

renderFilter();
renderSeen();
start();
