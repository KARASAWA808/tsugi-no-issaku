import "./style.css";
import { CATALOG, MEDIA, keyOf, type Media, type Work } from "./catalog";
import { LIKED_RATING, diagnose, type Recommendation } from "./diagnose";
import { loadImported } from "./imported";
import { MOODS, matches, type Filter } from "./filter";
import {
  interestList, isInterested, parseInterest, rateAndClear, serializeInterest, toggle, unmark, type Interest,
} from "./interest";
import {
  TOTAL_QUESTIONS, back, canSwap, createQuiz, currentRound, isDone, isLastQuestion, next, shownWorks, swap,
  type Quiz,
} from "./quiz";
import {
  RATINGS, parse, quizCatalog, ratingOf, seenList, serialize, unrate, type Rating, type Seen,
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
const INTEREST_KEY = "tsugi-no-issaku:interest";
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

/** 保存していた文字列の一覧を読む。壊れていれば空。知らない値は捨てる */
function loadList<T extends string>(key: string, isValid: (x: unknown) => x is T): T[] {
  try {
    const list = JSON.parse(load(key) ?? "[]");
    return Array.isArray(list) ? list.filter(isValid) : [];
  } catch {
    return [];
  }
}

const seen: Seen = parse(load(SEEN_KEY));
/** 「気になる」を付けた作品。☆とは別に保存する */
const interest: Interest = parseInterest(load(INTEREST_KEY));
const savedMedia = loadList(MEDIA_KEY, (x): x is Media => MEDIA.includes(x as Media));
/** 診断する種類。保存がなければ全種類 */
const media = new Set<Media>(savedMedia.length ? savedMedia : MEDIA);
/** ジャンル。保存がなければ指定なし(すべて) */
const moods = new Set(loadList(MOODS_KEY, (x): x is string => MOODS.some((m) => m.name === x)));
/** 条件に合う作品がないときは null。そのあいだ設問のボタンは押せない */
let quiz: Quiz | null = null;
/** 今回の設問を始めた時点で評価済みだった作品名。今回付けた評価を数えるのに使う */
let ratedAtStart = new Set<string>();
/** おすすめのカードで評価したときの一言。カードはすぐ消えるので、ここで保存を知らせる */
let rateMessage = "";
/**
 * メディア芸術データベースと TMDB から取り込んだ作品。読み終わるまでは空。
 * 設問には使わず(ひとことがなく、知っているか判断しにくい)、おすすめの第2段と見た作品の一覧に使う
 */
let imported: Work[] = [];
/** 取り込んだ作品を読めなかったとき */
let importedError = false;

/** 手書きの作品と取り込んだ作品を合わせた全作品。評価と「気になる」の一覧と、診断の元に使う */
const allWorks = (): Work[] => imported.length ? CATALOG.concat(imported) : CATALOG;

const filterOf = (gemsOnly = false): Filter => ({ media, moods, gemsOnly });

/** 描き直しても、押していたボタンにフォーカスを戻す */
function keepFocus(render: () => void) {
  const key = (document.activeElement as HTMLElement | null)?.dataset?.key;
  render();
  if (key) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

/** 評価や「気になる」が変わったら保存して、今の画面と下の一覧を描き直す。☆を付けると気になるも外れるので両方保存する */
function onSeenChange() {
  store(SEEN_KEY, serialize(seen));
  store(INTEREST_KEY, serializeInterest(interest));
  keepFocus(() => {
    if (!$("quiz").hidden) renderQuestion();
    if (!$("result").hidden) renderResult();
    renderSeen();
    renderInterest();
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
    b.dataset.key = `${scope}:${keyOf(work)}:${n}`;
    b.setAttribute("aria-label", `星${n}`);
    b.setAttribute("aria-pressed", String(current === n));
    b.onclick = () => {
      if (opts.clearable && current === n) unrate(seen, keyOf(work));
      else rateAndClear(seen, interest, keyOf(work), n as Rating);
      if (scope === "pop" || scope === "db") {
        rateMessage = `『${work.title}』を星${n}で見た作品に入れました。診断にもすぐ反映しています。付け直しや取り消しは下の「見た作品」からできます。`;
      }
      onSeenChange();
    };
    row.append(b);
  }
  return row;
}

/**
 * 「気になる」の切り替えボタン。まだ見ていないが興味がある作品に付ける。☆とは別で、押しても☆は変わらない。
 * scope は stars と同じく、同じ作品が複数か所に出るときのフォーカスの区別。
 */
function wantButton(work: Work, scope: string) {
  const on = isInterested(interest, work);
  const b = el("button", "want", "気になる");
  b.type = "button";
  b.dataset.key = `want:${scope}:${keyOf(work)}`;
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", `『${work.title}』を気になる作品に${on ? "入れている" : "入れる"}`);
  b.onclick = () => { toggle(interest, keyOf(work)); onSeenChange(); };
  return b;
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

/** 種類の注意書きの元の文。警告を出したあと、ここに戻す */
const MEDIA_NOTE = $("mediaNote").textContent ?? "";

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

/** 設問はいつも今の条件で作り直す。結果画面ならおすすめだけ描き直し、設問の途中なら出し直す */
function afterFilterChange() {
  rebuildQuiz();
  if (!$("result").hidden) renderResult();
  else showQuiz();
}

// ---- 設問 ----
/** 今の種類とジャンルで設問を作る。条件に合う作品がなければ quiz は null */
function rebuildQuiz() {
  rateMessage = "";
  const { works, filled } = quizCatalog(CATALOG.filter((w) => matches(w, filterOf())), seen);
  ratedAtStart = new Set(works.filter((w) => ratingOf(seen, w) !== undefined).map((w) => keyOf(w)));
  if (works.length === 0) {
    quiz = null;
    return;
  }
  quiz = createQuiz(works);
  const notes = [];
  if (quiz.total < TOTAL_QUESTIONS) notes.push(`選んだ種類やジャンルの作品が少ないので、設問は${quiz.total}問です。`);
  if (filled) notes.push(`まだ評価していない作品が少ないので、評価済みの作品も${filled}作まぜています。☆を付け直せます。`);
  const note = $("quizNote");
  note.hidden = notes.length === 0;
  note.textContent = notes.join("");
}

function start() {
  rebuildQuiz();
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
  if (!quiz) {
    showEmptyQuiz();
    return;
  }
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
      const wanted = isInterested(interest, work);
      const card = el("div", "opt" + (rated ? " rated" : wanted ? " wanted" : ""));
      const rateRow = el("div", "rate");
      rateRow.append(el("span", "rate-label", rated ? "見た" : "見たなら"), stars(work, "q", { clearable: true }));
      card.append(el("span", "kind", work.media), el("span", "name", work.title), el("span", "sub", work.pitch), rateRow);
      // ☆を付けた作品は見たことになるので、「気になる」は出さない
      if (!rated) {
        const wantRow = el("div", "rate want-row");
        wantRow.append(el("span", "rate-label", "まだなら"), wantButton(work, "q"));
        card.append(wantRow);
      }
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
/** おすすめ1作のPOPカード。取り込んだ作品はひとことの代わりに発表年とタグを出し、出典の作品ページへつなぐ */
function popCard({ work, from, fromRating, shared, interested }: Recommendation, scope: string) {
  const card = el("article", "pop" + (interested ? " pop-wanted" : ""));
  const top = el("div", "pop-top");
  top.append(el("span", "media", work.media));
  if (work.gem) top.append(el("span", "surprise", "隠れた名作"));
  if (interested) top.append(el("span", "wantmark", "気になる"));
  if (work.year) top.append(el("span", "year", `${work.year}年`));
  const rateRow = el("div", "pop-rate");
  rateRow.append(el("span", undefined, "もう見た?"), stars(work, scope, { clearable: false }), wantButton(work, scope));
  const foot = el("div", "pop-foot");
  const link = el("a", undefined, work.source ? `${work.source.name}で見る` : "作品を調べる");
  link.href = work.source?.url ?? "https://www.google.com/search?q=" + encodeURIComponent(`${work.title} ${work.media}`);
  link.target = "_blank";
  link.rel = "noopener";
  foot.append(el("span", undefined, `『${from.title}』に☆${fromRating}を付けたあなたへ`), link);
  const lead = work.pitch ? el("p", "pitch", work.pitch) : el("div", "chips");
  if (!work.pitch) lead.append(...work.tags.map((t) => el("span", "tag", t)));
  card.append(
    top,
    lead,
    el("h3", undefined, `『${work.title}』`),
    el("p", "reason", `『${from.title}』と同じく「${shared.join("」「")}」を味わえる作品です。`),
    rateRow,
    foot,
  );
  return card;
}

function renderResult() {
  const ratings = seenList(allWorks(), seen);
  const likedCount = ratings.filter((r) => r.rating >= LIKED_RATING).length;
  const gemsOnly = $<HTMLInputElement>("gemsOnly").checked;
  const wanted = interestList(allWorks(), interest);
  const d = diagnose({ ratings, interested: wanted, catalog: CATALOG.filter((w) => matches(w, filterOf(gemsOnly))) });

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

  $("shelf").replaceChildren(...d.recommendations.map((r) => popCard(r, "pop")));
  renderImportedShelf(ratings, wanted, likedCount > 0);

  $("rateNote").textContent = rateMessage;
  const thisTime = (quiz ? shownWorks(quiz) : [])
    .filter((w) => ratingOf(seen, w) !== undefined && !ratedAtStart.has(keyOf(w))).length;
  $("picks").textContent = (ratings.length
    ? `☆を付けた${ratings.length}作から診断しました。今回の設問で評価したのは${thisTime}作です。`
    : "☆を付けた作品はまだありません。")
    + (wanted.length ? `「気になる」を付けた${wanted.length}作も弱い手がかりにしています。` : "");
}

/**
 * メディア芸術データベースと TMDB から取り込んだ作品のおすすめ(第2段)。1つの段にまとめ、出典はカードごとのリンクで示す。
 * 手書きの作品とは分けて出す。ひとことがなく、隠れた名作の印もないので、「隠れた名作だけ」のときは出さない
 */
function renderImportedShelf(ratings: ReturnType<typeof seenList>, wanted: Work[], hasLiked: boolean) {
  const section = $("dbSection");
  const note = $("dbNote");
  const gemsOnly = $<HTMLInputElement>("gemsOnly").checked;
  const recs = imported.length && hasLiked && !gemsOnly
    ? diagnose({ ratings, interested: wanted, catalog: imported.filter((w) => matches(w, filterOf())) }).recommendations
    : [];
  section.hidden = !hasLiked || gemsOnly;
  $("dbShelf").replaceChildren(...recs.map((r) => popCard(r, "db")));
  note.hidden = recs.length > 0;
  note.textContent = importedError
    ? "データベースの作品を読み込めませんでした。"
    : !imported.length
      ? "データベースの作品を読み込んでいます…"
      : !["漫画", "アニメ", "ゲーム", "映画", "ドラマ"].some((m) => media.has(m as Media))
        ? "取り込んだ作品は漫画・アニメ・ゲーム・映画・ドラマだけです。診断する種類にどれかを入れると、ここにも出ます。"
        : "選んだ種類やジャンルで、好みに合う作品が見つかりませんでした。";
}

// ---- 見た作品の一覧 ----
function renderSeen() {
  const list = seenList(allWorks(), seen);
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
      undo.dataset.key = `undo:${keyOf(work)}`;
      undo.setAttribute("aria-label", `『${work.title}』を見た作品から外す`);
      undo.onclick = () => { unrate(seen, keyOf(work)); onSeenChange(); };
      li.append(name, stars(work, "list", { clearable: false }), undo);
      return li;
    }),
  );
}

// ---- 気になる作品の一覧 ----
function renderInterest() {
  const list = interestList(allWorks(), interest);
  $("interestCount").textContent = `${list.length}作`;
  $("interestEmpty").hidden = list.length > 0;
  $("interestList").replaceChildren(
    ...list.map((work) => {
      const li = el("li");
      const name = el("span", "seen-name");
      name.append(el("span", "kind", work.media), el("span", undefined, work.title));
      const off = el("button", "btn btn-quiet btn-small", "外す");
      off.type = "button";
      off.dataset.key = `unwant:${keyOf(work)}`;
      off.setAttribute("aria-label", `『${work.title}』を気になる作品から外す`);
      off.onclick = () => { unmark(interest, keyOf(work)); onSeenChange(); };
      li.append(name, off);
      return li;
    }),
  );
}

$("nextBtn").onclick = onNext;
$("backBtn").onclick = () => { if (quiz) { back(quiz); renderQuestion(); } };
$("swapBtn").onclick = () => { if (quiz && swap(quiz)) renderQuestion(); };
$("fixBtn").onclick = () => { if (quiz) back(quiz); showQuiz(); };
$("gemsOnly").onchange = renderResult;
$("retryBtn").onclick = start;

renderFilter();
renderSeen();
renderInterest();
start();

// 取り込んだ作品は量が多いので、画面を出してから読む。読めなくても手書きの作品だけで動く
loadImported(CATALOG).then((works) => {
  imported = works;
}).catch(() => {
  importedError = true;
}).finally(() => {
  keepFocus(() => {
    if (!$("result").hidden) renderResult();
    renderSeen();
    renderInterest();
  });
});
