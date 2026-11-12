// 画面の描画はここだけ。解析と文章づくりは analyze / intro / review に任せる。
// 名前などの外から来た文字は textContent でだけ入れる(innerHTML は使わない)。
import "./style.css";
import { type Analysis, type Axis, analyze } from "./analyze";
import { type Intro, buildIntro } from "./intro";
import { CRITIC_NAME, ROLE_LABELS, f1, pct, rankLabel } from "./labels";
import { type Review, buildReview } from "./review";
import { SAMPLE_PLAYERS, samplePlayer } from "./sample";
import type { ApiError, PlayerData } from "./types";

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

function actHead(num: string, title: string, tag = ""): HTMLElement {
  return el(
    "div",
    { class: "act-head" },
    el("span", { class: "num", "aria-hidden": "true" }, num),
    el("h2", { tabindex: "-1" }, title),
    tag ? el("span", { class: "tag" }, tag) : null,
  );
}

function profileAct({ player, analysis: a }: View): HTMLElement {
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
  );
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
  el("p", { class: "speaker critic" }, CRITIC_NAME, el("span", { class: "unofficial" }, "非公式・自動生成"));

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
    talk.append(el("p", { class: "sub-head" }, "自己紹介になかった話"));
    for (const roast of review.roasts) talk.append(el("p", { class: "bubble critic" }, roast.text));
  }
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

  return el(
    "section",
    { class: "act", id: "review", "aria-label": "辛口評価" },
    actHead("③", `${CRITIC_NAME}の辛口評価`, "架空のキャラクター"),
    talk,
    el("div", { class: "actions" }, again, other),
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
  const options = { variant: view.variant, champName };
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
}

init();
