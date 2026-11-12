// 画面の描画はここだけ。解析と文章づくりは analyze / intro / review に任せる。
// 名前などの外から来た文字は textContent でだけ入れる(innerHTML は使わない)。
import "./style.css";
import { type Analysis, type Axis, analyze } from "./analyze";
import { type Split, winRateOf } from "./detail";
import { IMAGINED_PHRASES } from "./imagined-phrases";
import { type Intro, buildIntro } from "./intro";
import { CRITIC_NAME, ROLE_LABELS, f1, pct, rankLabel } from "./labels";
import { BUILTIN_PHRASES, type PhraseBook, emptyBook, mergePhrases, parsePhrases } from "./phrases";
import { type Review, buildReview } from "./review";
import { SAMPLE_PLAYERS, samplePlayer } from "./sample";
import type { ApiError, MatchStat, PlayerData } from "./types";

const PLATFORM_LABELS: readonly (readonly [string, string])[] = [
  ["jp1", "日本"],
  ["kr", "韓国"],
  ["na1", "北米"],
  ["euw1", "西ヨーロッパ"],
  ["eun1", "北・東ヨーロッパ"],
  ["oc1", "オセアニア"],
  ["sg2", "東南アジア"],
  ["tw2", "台湾"],
  ["vn2", "ベトナム"],
  ["br1", "ブラジル"],
  ["la1", "ラテンアメリカ北"],
  ["la2", "ラテンアメリカ南"],
  ["tr1", "トルコ"],
];
const STORAGE_KEY = "karakuchi-dojo:last";
const IMAGINED_KEY = "karakuchi-dojo:imagined";

type Child = Node | string | null | false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) if (child !== null && child !== false) node.append(child);
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string>, text?: string): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function need<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} がありません`);
  return node as T;
}

const form = need<HTMLFormElement>("form");
const riotIdInput = need<HTMLInputElement>("riotId");
const platformSelect = need<HTMLSelectElement>("platform");
const submitButton = need<HTMLButtonElement>("submit");
const keyNote = need<HTMLParagraphElement>("keyNote");
const sampleList = need<HTMLDivElement>("samples");
const statusLine = need<HTMLParagraphElement>("status");
const result = need<HTMLElement>("result");

interface View {
  player: PlayerData;
  analysis: Analysis;
  /** 「言い直してもらう」を押した回数 */
  variant: number;
  /** ③ の評価まで見せているか */
  revealed: boolean;
  /** 選んだサンプルのID。Riot ID で調べたときは null */
  sampleId: string | null;
}
let view: View | null = null;

// --- チャンピオンの日本語名とアイコン(Data Dragon)。取れなければIDのまま、アイコンは頭文字で出す ---
interface Dragon {
  version: string;
  names: Map<string, string>;
}
let dragon: Dragon | null = null;

async function loadDragon(): Promise<void> {
  try {
    const versions: unknown = await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json();
    const version = Array.isArray(versions) && typeof versions[0] === "string" ? versions[0] : null;
    if (!version) return;
    const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ja_JP/champion.json`);
    const body = (await res.json()) as { data?: Record<string, { name?: unknown }> };
    const names = new Map<string, string>();
    for (const [id, champion] of Object.entries(body.data ?? {})) {
      if (typeof champion.name === "string") names.set(id, champion.name);
    }
    dragon = { version, names };
    if (view) render();
  } catch {
    // オフラインでも遊べるように、失敗は黙って流す
  }
}

const champName = (id: string): string => dragon?.names.get(id) ?? id;

// --- 手元にだけ置く素材(lol/public/local/)。git 管理外なので、無いのがふつう。あれば使う ---
interface LocalAssets {
  /** 評価役のアイコンにする画像 */
  avatar: string | null;
  /** ③ の見出しに出すロゴ */
  logo: string | null;
  /** 自分で足した口ぐせ */
  phrases: PhraseBook;
}
const local: LocalAssets = { avatar: null, logo: null, phrases: emptyBook() };

/** 候補を順に試し、画像として読めた最初のものを返す */
async function findImage(candidates: readonly string[]): Promise<string | null> {
  for (const src of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    if (ok) return src;
  }
  return null;
}

async function loadLocal(): Promise<void> {
  const images = (name: string): string[] => ["png", "jpg", "jpeg", "webp"].map((ext) => `local/${name}.${ext}`);
  const [avatar, logo, phrases] = await Promise.all([
    findImage(images("critic")),
    findImage(images("logo")),
    // ファイルが無いと開発サーバーは index.html を返すので、JSON として読めなければ「無い」とみなす
    fetch("local/phrases.json").then((res) => (res.ok ? res.json() : null)).then(parsePhrases).catch(() => emptyBook()),
  ]);
  Object.assign(local, { avatar, logo, phrases });
  if (view) render();
}

// --- 「言いそうな台詞」(作った口ぐせ)も混ぜるか。ブラウザに覚えておく。覚えられなければ、開くたびにオン ---
let useImagined = true;
try {
  useImagined = localStorage.getItem(IMAGINED_KEY) !== "off";
} catch {
  // 何もしない
}

function setUseImagined(on: boolean): void {
  useImagined = on;
  try {
    localStorage.setItem(IMAGINED_KEY, on ? "on" : "off");
  } catch {
    // 何もしない
  }
}

// --- 前回の入力を覚えておく(localStorage が使えなければ覚えないだけ) ---
function restoreLast(): void {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof saved !== "object" || saved === null) return;
    const { riotId, platform } = saved as { riotId?: unknown; platform?: unknown };
    if (typeof riotId === "string") riotIdInput.value = riotId.slice(0, 24);
    if (typeof platform === "string" && PLATFORM_LABELS.some(([id]) => id === platform)) platformSelect.value = platform;
  } catch {
    // 何もしない
  }
}

function saveLast(riotId: string, platform: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ riotId, platform }));
  } catch {
    // 何もしない
  }
}

function setStatus(text: string, error = false): void {
  statusLine.textContent = text;
  statusLine.classList.toggle("error", error);
}

function setBusy(busy: boolean): void {
  submitButton.disabled = busy;
  for (const button of sampleList.querySelectorAll("button")) button.disabled = busy;
}

// --- ① 解析 ---
function radar(axes: readonly Axis[]): SVGElement {
  const size = 240;
  const center = size / 2;
  const radius = 78;
  const point = (index: number, r: number): [number, number] => {
    const angle = (Math.PI * 2 * index) / axes.length - Math.PI / 2;
    return [center + Math.cos(angle) * r, center + Math.sin(angle) * r];
  };
  const ring = (r: number): string => axes.map((_, i) => point(i, r).map((n) => n.toFixed(1)).join(",")).join(" ");

  const root = svg("svg", { viewBox: `0 0 ${size} ${size}`, class: "radar", "aria-hidden": "true" });
  for (const step of [0.25, 0.5, 0.75, 1]) root.append(svg("polygon", { points: ring(radius * step), class: "grid" }));
  axes.forEach((axis, i) => {
    const [x, y] = point(i, radius);
    root.append(svg("line", { x1: String(center), y1: String(center), x2: x.toFixed(1), y2: y.toFixed(1), class: "spoke" }));
    const [tx, ty] = point(i, radius + 18);
    root.append(svg("text", { x: tx.toFixed(1), y: ty.toFixed(1), "text-anchor": "middle", "dominant-baseline": "middle" }, axis.label));
  });
  // 0点でも形が見えるように、中心から少しだけ離す
  const shape = axes.map((axis, i) => point(i, radius * Math.max(0.06, axis.score / 100)).map((n) => n.toFixed(1)).join(",")).join(" ");
  root.append(svg("polygon", { points: shape, class: "shape" }));
  return root;
}

function tile(label: string, value: string, sub = ""): HTMLElement {
  return el("div", { class: "tile" }, el("dt", {}, label), el("dd", {}, value, sub ? el("small", {}, sub) : null));
}

function championIcon(id: string): HTMLElement {
  const icon = el("span", { class: "icon", "aria-hidden": "true" }, champName(id).slice(0, 1));
  if (dragon) {
    const img = el("img", { alt: "", loading: "lazy", src: `https://ddragon.leagueoflegends.com/cdn/${dragon.version}/img/champion/${encodeURIComponent(id)}.png` });
    img.addEventListener("load", () => icon.replaceChildren(img));
  }
  return icon;
}

function actHead(num: string, title: string, tag = "", logo: string | null = null): HTMLElement {
  return el(
    "div",
    { class: "act-head" },
    el("span", { class: "num", "aria-hidden": "true" }, num),
    el("h2", { tabindex: "-1" }, title),
    logo ? el("img", { class: "logo", src: logo, alt: "" }) : null,
    tag ? el("span", { class: "tag" }, tag) : null,
  );
}

function profileAct(view: View): HTMLElement {
  const { player, analysis: a } = view;
  const support = a.mainRole === "UTILITY";
  return el(
    "section",
    { class: "act", "aria-label": "解析" },
    actHead("①", `直近${a.games}試合の解析`),
    el(
      "div",
      { class: "who" },
      el("span", { class: "name" }, player.gameName, el("span", { class: "tagline" }, ` #${player.tagLine}`)),
      el(
        "div",
        { class: "chips" },
        player.sample ? el("span", { class: "chip demo" }, "サンプル(架空)") : null,
        el("span", { class: "chip" }, rankLabel(player.rank)),
        el("span", { class: "chip" }, `メイン: ${ROLE_LABELS[a.mainRole]}`),
        player.level !== null && el("span", { class: "chip" }, `Lv ${player.level}`),
      ),
    ),
    el(
      "div",
      { class: "board" },
      radar(a.axes),
      el(
        "ul",
        { class: "axes", "aria-label": "6つの軸の点数(100点満点)" },
        ...a.axes.map((axis) => {
          const fill = el("i");
          fill.style.width = `${axis.score}%`;
          return el(
            "li",
            { class: axis.score < 40 ? "axis low" : "axis" },
            el("span", {}, axis.label),
            el("span", { class: "bar", "aria-hidden": "true" }, fill),
            el("span", { class: "score" }, String(axis.score)),
          );
        }),
      ),
    ),
    el(
      "dl",
      { class: "tiles" },
      tile("勝率", `${pct(a.winRate)}%`, `${a.wins}勝${a.games - a.wins}敗`),
      tile("KDA", f1(a.avg.kda), `${f1(a.avg.kills)}/${f1(a.avg.deaths)}/${f1(a.avg.assists)}`),
      support ? null : tile("CS", f1(a.avg.csPerMin), "/分"),
      tile("キル関与率", `${pct(a.avg.killParticipation)}%`),
      tile("ダメージ割合", `${pct(a.avg.damageShare)}%`),
      tile("視界スコア", f1(a.avg.visionPerMin), "/分"),
      tile("コントロールワード", f1(a.avg.controlWards), "本/試合"),
      tile("デス", f1(a.avg.deathsPer30), "/30分"),
    ),
    el(
      "ul",
      { class: "champs", "aria-label": "よく使うチャンピオン" },
      ...a.champions.slice(0, 5).map((c) =>
        el(
          "li",
          { class: "champ" },
          championIcon(c.champion),
          el("span", {}, el("b", {}, champName(c.champion)), el("span", {}, `${c.games}試合・勝率${pct(c.wins / c.games)}%`)),
        ),
      ),
    ),
    detailBlock(view),
  );
}

// --- ①のつづき: くわしい解析 ---
const signed = (n: number | null, digits = 0): string => {
  if (n === null) return "—";
  const rounded = digits === 0 ? Math.round(n) : Number(n.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toLocaleString("ja-JP")}`;
};

/** 条件別の勝率の1行。試合のない条件は出さない */
function splitRow(label: string, split: Split): HTMLElement | null {
  if (split.games === 0) return null;
  const rate = winRateOf(split);
  const fill = el("i");
  fill.style.width = `${Math.round(rate * 100)}%`;
  return el(
    "li",
    { class: rate < 0.4 ? "split low" : "split" },
    el("span", { class: "split-label" }, label),
    el("span", { class: "split-games" }, `${split.games}試合`),
    el("span", { class: "bar", "aria-hidden": "true" }, fill),
    el("span", { class: "score" }, `${pct(rate)}%`),
  );
}

function splitGroup(title: string, rows: (HTMLElement | null)[]): HTMLElement | null {
  const shown = rows.filter((row): row is HTMLElement => row !== null);
  if (shown.length === 0) return null;
  return el("div", { class: "split-group" }, el("h4", {}, title), el("ul", { class: "splits" }, ...shown));
}

function matchRow(m: MatchStat, score: number): HTMLElement {
  const minutes = Math.max(1, m.durationSec / 60);
  const fill = el("i");
  fill.style.width = `${score}%`;
  return el(
    "tr",
    { class: m.win ? "won" : "lost" },
    el("td", { class: "result" }, m.win ? "勝" : "負"),
    el("th", { scope: "row" }, champName(m.champion), el("small", {}, ROLE_LABELS[m.role])),
    el("td", { class: "num" }, `${m.kills}/${m.deaths}/${m.assists}`),
    el("td", { class: "num" }, m.role === "UTILITY" ? "—" : f1(m.cs / minutes)),
    el("td", { class: "num" }, `${Math.round(minutes)}分`),
    el("td", { class: "match-score" }, el("span", { class: score < 40 ? "bar low" : "bar", "aria-hidden": "true" }, fill), el("span", { class: "score" }, String(score))),
  );
}

function detailBlock({ player, analysis: a }: View): HTMLElement {
  const d = a.detail;
  const support = a.mainRole === "UTILITY";
  const block = el("div", { class: "detail" }, el("h3", {}, "くわしい解析"));

  // レーン戦: 対面(相手チームの同じロール)との差
  if (d.lane.games > 0) {
    block.append(
      el("h4", {}, "レーン戦(対面との差)"),
      el(
        "dl",
        { class: "tiles" },
        d.lane.goldDiff15 !== null && tile("15分のゴールド差", signed(d.lane.goldDiff15)),
        d.lane.goldDiff10 !== null && tile("10分のゴールド差", signed(d.lane.goldDiff10)),
        d.lane.csDiff10 !== null && !support && tile("10分のCS差", signed(d.lane.csDiff10, 1)),
        d.lane.wonRate !== null && tile("レーンで差をつけた試合", `${pct(d.lane.wonRate)}%`),
        d.lane.takedowns10 !== null && tile("10分までのキル関与", f1(d.lane.takedowns10), "回/試合"),
        d.lane.goldDiff !== null && tile("試合終了時のゴールド差", signed(d.lane.goldDiff)),
        d.plates > 0 && tile("タワープレート", f1(d.plates), "枚/試合"),
      ),
    );
  }

  // デスの内訳: いつ・どこで・だれに
  if (d.deaths && d.deaths.counted > 0) {
    const phases: [string, number, string][] = [
      ["〜10分", d.deaths.early, "early"],
      ["10〜25分", d.deaths.mid, "mid"],
      ["25分〜", d.deaths.late, "late"],
    ];
    const bar = el("div", { class: "phase-bar", role: "img", "aria-label": phases.map(([label, share]) => `${label} ${pct(share)}%`).join("、") });
    for (const [label, share, name] of phases) {
      if (share <= 0) continue;
      const part = el("span", { class: `phase ${name}` }, share >= 0.12 ? `${label} ${pct(share)}%` : "");
      part.style.flexGrow = String(Math.max(0.02, share));
      bar.append(part);
    }
    block.append(
      el("h4", {}, `デスの内訳(時刻の分かった${d.deaths.counted}デス)`),
      bar,
      el(
        "dl",
        { class: "tiles" },
        tile("10分までのデス", f1(d.deaths.per10), "回/試合"),
        tile("相手の陣地でのデス", `${pct(d.deaths.deep)}%`),
        tile("1対1でやられたデス", `${pct(d.deaths.solo)}%`),
      ),
    );
  } else {
    block.append(el("p", { class: "note" }, "デスの時刻と場所は、この試合では取れませんでした。"));
  }

  // 条件別の勝率
  const groups = [
    splitGroup("サイド", [splitRow("青側", d.side.blue), splitRow("赤側", d.side.red)]),
    splitGroup("試合の長さ", [splitRow("25分未満", d.length.short), splitRow("25〜35分", d.length.mid), splitRow("35分以上", d.length.long)]),
    splitGroup("始めた時刻", [splitRow("朝(5〜11時)", d.time.morning), splitRow("昼(11〜17時)", d.time.day), splitRow("夜(17〜24時)", d.time.evening), splitRow("深夜(0〜5時)", d.time.night)]),
    splitGroup("調子", [splitRow("直近5試合", d.recent), splitRow("それより前", d.earlier)]),
    splitGroup("連戦", [splitRow("負けた直後", d.afterLoss), splitRow("勝った直後", d.afterWin)]),
    splitGroup("15分の状況", [splitRow("リード", d.ahead15), splitRow("ビハインド", d.behind15)]),
    splitGroup("種類", [splitRow("ランク", d.queue.ranked), splitRow("ノーマル", d.queue.normal)]),
  ].filter((group): group is HTMLElement => group !== null);
  block.append(el("h4", {}, "条件別の勝率"), el("div", { class: "split-grid" }, ...groups));

  block.append(
    el("h4", {}, "そのほか"),
    el(
      "dl",
      { class: "tiles" },
      tile("最長の連戦", String(d.longestSession), "試合"),
      tile("降参で終わった負け", String(d.surrenders), "試合"),
      tile("「?」ピン", f1(d.missingPings), "回/試合"),
      tile("オブジェクト関与", `${pct(d.objectiveShare)}%`),
      tile("CCをかけた時間", String(Math.round(d.ccSec)), "秒/試合"),
      tile("避けたスキル", String(Math.round(d.dodged)), "発/試合"),
      support && tile("回復+シールド", String(Math.round(d.healShieldPerMin)), "/分"),
      d.steals > 0 && tile("スティール", String(d.steals), "回"),
    ),
  );

  const table = el(
    "table",
    { class: "matches" },
    el("thead", {}, el("tr", {}, el("th", {}, ""), el("th", {}, "チャンピオン"), el("th", {}, "K/D/A"), el("th", {}, "CS/分"), el("th", {}, "時間"), el("th", {}, "出来"))),
    el("tbody", {}, ...player.matches.map((m, i) => matchRow(m, d.scores[i]))),
  );
  block.append(el("details", { class: "match-list" }, el("summary", {}, `${a.games}試合の一覧(新しい順)`), el("div", { class: "table-wrap" }, table)));
  return block;
}

// --- ② 自己紹介 ---
function introAct(current: View, intro: Intro): HTMLElement {
  const talk = el(
    "div",
    { class: "talk" },
    el("p", { class: "speaker me" }, current.player.gameName),
    el("p", { class: "bubble me" }, intro.greeting),
    ...intro.claims.map((claim) => el("p", { class: "bubble me claim" }, claim.text)),
    el("p", { class: "bubble me" }, intro.closing),
  );
  const act = el("section", { class: "act", "aria-label": "自己紹介" }, actHead("②", "自己紹介", "成績から自動で作成"), talk);
  if (!current.revealed) {
    const cue = el("button", { class: "btn btn-critic", type: "button" }, `${CRITIC_NAME}の評価を聞く`);
    cue.addEventListener("click", () => {
      current.revealed = true;
      render();
      focusReview();
    });
    act.append(el("div", { class: "cue" }, cue));
  }
  return act;
}

// --- ③ 辛口評価 ---
const criticLabel = (): HTMLElement =>
  el(
    "p",
    { class: "speaker critic" },
    local.avatar ? el("img", { class: "avatar", src: local.avatar, alt: "" }) : null,
    CRITIC_NAME,
    el("span", { class: "unofficial" }, "非公式・自動生成"),
  );

function reviewAct(current: View, intro: Intro, review: Review): HTMLElement {
  const talk = el("div", { class: "talk reveal" }, criticLabel(), el("p", { class: "bubble critic" }, review.opening));
  review.replies.forEach((reply, i) => {
    talk.append(
      el(
        "div",
        { class: "exchange" },
        el("p", { class: "quote" }, `「${intro.claims[i].text}」`),
        el(
          "div",
          { class: "answer" },
          el("span", { class: reply.accepted ? "stamp yes" : "stamp no" }, reply.accepted ? "認める" : "却下"),
          el("p", { class: "bubble critic" }, reply.text),
        ),
      ),
    );
  });
  if (review.roasts.length > 0) {
    talk.append(el("p", { class: "sub-head" }, "まだある、ちくちく"));
    for (const roast of review.roasts) talk.append(el("p", { class: "bubble critic" }, roast.text));
  }
  talk.append(el("p", { class: "sub-head" }, "いちばん良かった試合"), el("p", { class: "bubble critic" }, review.highlight));
  talk.append(
    el(
      "div",
      { class: "verdict" },
      el("p", { class: review.grade === "S" || review.grade === "A" ? "grade top" : "grade", "aria-label": `総合評価 ${review.grade}` }, review.grade),
      el("p", { class: "grade-label" }, `総合 ${current.analysis.overall}点 / 称号`),
      el("p", { class: "title" }, review.title),
      el("p", { class: "say" }, review.verdict),
      el("dl", { class: "homework" }, el("dt", {}, "次の宿題"), el("dd", {}, review.homework)),
    ),
  );
  [...talk.children].forEach((child, i) => (child as HTMLElement).style.setProperty("--i", String(i)));

  const again = el("button", { class: "btn", type: "button" }, "言い直してもらう");
  again.addEventListener("click", () => {
    current.variant += 1;
    render();
    focusReview();
  });
  const other = el("button", { class: "btn btn-quiet", type: "button" }, "別のIDで試す");
  other.addEventListener("click", () => {
    view = null;
    render();
    setStatus("");
    window.scrollTo({ top: 0 });
    riotIdInput.focus();
  });

  const imagined = el("input", { type: "checkbox", id: "useImagined" });
  imagined.checked = useImagined;
  imagined.addEventListener("change", () => {
    setUseImagined(imagined.checked);
    render();
    document.getElementById("useImagined")?.focus();
  });

  return el(
    "section",
    { class: "act", id: "review", "aria-label": "辛口評価" },
    actHead("③", `${CRITIC_NAME}の辛口評価`, "非公式のパロディ", local.logo),
    talk,
    el("div", { class: "actions" }, again, other),
    el(
      "label",
      { class: "toggle", for: "useImagined" },
      imagined,
      el("span", {}, "言いそうな台詞も混ぜる", el("small", {}, "オフにすると、口ぐせは実際の発言として記録のあるものだけになります")),
    ),
  );
}

function focusReview(): void {
  const heading = document.querySelector<HTMLElement>("#review h2");
  if (!heading) return;
  heading.focus({ preventScroll: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("review")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function render(): void {
  for (const button of sampleList.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(view !== null && button.dataset.id === view.sampleId));
  }
  if (!view) {
    result.hidden = true;
    result.replaceChildren();
    return;
  }
  const phrases = useImagined ? mergePhrases(BUILTIN_PHRASES, local.phrases, IMAGINED_PHRASES) : mergePhrases(BUILTIN_PHRASES, local.phrases);
  const options = { variant: view.variant, champName, phrases };
  const intro = buildIntro(view.player, view.analysis, options);
  const sections = [profileAct(view), introAct(view, intro)];
  if (view.revealed) sections.push(reviewAct(view, intro, buildReview(view.player, view.analysis, intro, options)));
  result.replaceChildren(...sections);
  result.hidden = false;
}

function show(player: PlayerData, sampleId: string | null): void {
  const analysis = analyze(player);
  if (!analysis) {
    view = null;
    render();
    setStatus("集計できる試合がありませんでした。", true);
    return;
  }
  view = { player, analysis, variant: 0, revealed: false, sampleId };
  setStatus("");
  render();
  result.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  result.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

async function lookUp(riotId: string, platform: string): Promise<void> {
  setBusy(true);
  setStatus("試合を集めています…(20試合ぶん。数秒かかります)");
  try {
    const res = await fetch(`/api/player?riotId=${encodeURIComponent(riotId)}&platform=${encodeURIComponent(platform)}`);
    const body: unknown = await res.json();
    if (!res.ok) {
      setStatus((body as ApiError).message || "取得できませんでした。", true);
      return;
    }
    saveLast(riotId, platform);
    show(body as PlayerData, null);
  } catch {
    setStatus("サーバーに届きませんでした。npm run lol で起動した画面から使ってください。", true);
  } finally {
    setBusy(false);
  }
}

async function checkKey(): Promise<void> {
  let hasKey = false;
  try {
    const res = await fetch("/api/status");
    hasKey = res.ok && ((await res.json()) as { hasKey?: unknown }).hasKey === true;
  } catch {
    // サーバーなしで開かれている。サンプルだけで遊べる
  }
  if (hasKey) return;
  keyNote.replaceChildren(
    "Riot API のキーがまだ設定されていません。いまは下のサンプルで遊べます。自分のIDで試すには、キーを ",
    el("code", {}, "lol/.env.local"),
    " に書いて起動し直してください(手順は README)。",
  );
  keyNote.hidden = false;
}

function init(): void {
  need<HTMLElement>("criticNameLead").textContent = CRITIC_NAME;
  need<HTMLElement>("criticNameFoot").textContent = CRITIC_NAME;
  for (const [id, label] of PLATFORM_LABELS) platformSelect.append(el("option", { value: id }, label));
  restoreLast();

  for (const sample of SAMPLE_PLAYERS) {
    const button = el("button", { class: "sample", type: "button", "aria-pressed": "false" }, el("b", {}, sample.label), el("span", {}, sample.blurb));
    button.dataset.id = sample.id;
    button.addEventListener("click", () => {
      const player = samplePlayer(sample.id);
      if (player) show(player, sample.id);
    });
    sampleList.append(button);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const riotId = riotIdInput.value.trim();
    if (!/.+[#＃].+/.test(riotId)) {
      setStatus("Riot ID は「名前#タグ」の形で入力してください(例: なまえ#JP1)。", true);
      riotIdInput.focus();
      return;
    }
    void lookUp(riotId, platformSelect.value);
  });

  void checkKey();
  void loadDragon();
  void loadLocal();
}

init();
