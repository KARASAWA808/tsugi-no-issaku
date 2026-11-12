// 文の候補の表(lol/src/text/)そのものの検査。数・中身・決まりごと。
import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { buildIntro } from "../lol/src/intro";
import { buildReview } from "../lol/src/review";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";
import { BEST_BOASTS, BOASTS, CLOSINGS, GREETINGS, SPINS } from "../lol/src/text/intro-lines";
import { CONNECTORS, NOTES, TITLE_PREFIXES } from "../lol/src/text/note-lines";
import { ACKS, BUTS, DEBUNKS } from "../lol/src/text/reply-lines";
import { type Line, type Values, valuesOf } from "../lol/src/text/values";
import { CLEAN_TITLES, HIGHLIGHTS, HOMEWORK, NO_HOMEWORK, OPENINGS, ROASTS, TITLES, VERDICTS } from "../lol/src/text/verdict-lines";
import type { PlayerData } from "../lol/src/types";
import { match, series, timeline } from "./lol-helpers";

const JST = { utcOffsetMinutes: 540 };

// 数字の出方が極端な人たち(0 や null が混ざる)
const extremes: PlayerData[] = [
  { gameName: "きびしい", tagLine: "TEST", level: 30, rank: null, matches: series(Array.from({ length: 12 }, (_, i) => ({
    win: i % 6 === 0, champion: `Champ${i}`, role: (["TOP", "MIDDLE", "BOTTOM"] as const)[i % 3], kills: 1, deaths: 11, assists: 1, cs: 90, csAt10: 30,
    damage: 6000, visionScore: 6, controlWards: 0, objectives: 0, turretTakedowns: 0, timeDeadSec: 420, teamKills: 20, surrendered: i % 6 !== 0, missingPings: 15,
    timeline: timeline({ goldDiff15: -1500, deathMinutes: [2, 4, 6, 8, 9, 12, 15, 18, 21, 24, 27], soloDeaths: 6, deepDeaths: 7 }),
  })), 5) },
  { gameName: "できすぎ", tagLine: "TEST", level: 300, rank: { tier: "CHALLENGER", division: "I", lp: 900, wins: 200, losses: 100 }, matches: series(Array.from({ length: 12 }, () => ({
    kills: 14, deaths: 1, assists: 9, cs: 280, csAt10: 95, damage: 34000, visionScore: 55, controlWards: 5, objectives: 5, turretTakedowns: 5, soloKills: 3,
    firstBlood: true, largestMultiKill: 5, timeDeadSec: 20, teamKills: 28, turretPlates: 4, ccSec: 60, skillshotsDodged: 80, epicSteals: 1, laneWon: true,
    timeline: timeline({ goldDiff15: 2000, deathMinutes: [22], soloDeaths: 0, deepDeaths: 0 }),
  }))) },
  { gameName: "なにもない", tagLine: "TEST", level: 1, rank: null, matches: [match({ role: "UNKNOWN", csAt10: null, csDiff: null, goldDiff: null, damageDiff: null, laneWon: null, timeline: null })] },
];
const players = [...SAMPLE_PLAYERS.map((s) => samplePlayer(s.id)!), ...extremes];
const allValues: Values[] = players.map((p) => valuesOf(p, analyze(p, JST)!, (id) => id));

const tables: [string, Record<string, readonly Line[]>][] = [
  ["BOASTS", BOASTS], ["SPINS", SPINS], ["ACKS", ACKS], ["DEBUNKS", DEBUNKS], ["ROASTS", ROASTS], ["HOMEWORK", HOMEWORK], ["VERDICTS", VERDICTS],
];
const lists: [string, readonly Line[]][] = [
  ["GREETINGS", GREETINGS], ["OPENINGS", OPENINGS], ["HIGHLIGHTS", HIGHLIGHTS], ["NO_HOMEWORK", NO_HOMEWORK], ["BUTS", BUTS.map((b) => b.line)],
  ["BEST_BOASTS", BEST_BOASTS], ["NOTES", NOTES.flatMap((n) => n.lines)],
];
const everyLine: [string, Line][] = [
  ...tables.flatMap(([name, table]) => Object.entries(table).flatMap(([key, lines]) => lines.map((line): [string, Line] => [`${name}.${key}`, line]))),
  ...lists.flatMap(([name, lines]) => lines.map((line): [string, Line] => [name, line])),
];
const fixedTexts: [string, string][] = [
  ...CLOSINGS.map((t): [string, string] => ["CLOSINGS", t]),
  ...CONNECTORS.map((t): [string, string] => ["CONNECTORS", t]),
  ...TITLE_PREFIXES.map((t): [string, string] => ["TITLE_PREFIXES", t]),
  ...Object.entries(TITLES).flatMap(([key, list]) => list.map((t): [string, string] => [`TITLES.${key}`, t])),
  ...Object.entries(CLEAN_TITLES).flatMap(([key, list]) => list.map((t): [string, string] => [`CLEAN_TITLES.${key}`, t])),
];

describe("文の候補の数", () => {
  const minOf = (table: Record<string, readonly unknown[]>) => Math.min(...Object.values(table).map((list) => list.length));

  it("どの話題にも、言い直して変わるだけの候補がある", () => {
    expect(minOf(BOASTS)).toBeGreaterThanOrEqual(9);
    expect(minOf(SPINS)).toBeGreaterThanOrEqual(8);
    expect(minOf(ACKS)).toBeGreaterThanOrEqual(9);
    expect(minOf(DEBUNKS)).toBeGreaterThanOrEqual(8);
    expect(minOf(ROASTS)).toBeGreaterThanOrEqual(9);
    expect(minOf(HOMEWORK)).toBeGreaterThanOrEqual(5);
    expect(minOf(TITLES)).toBeGreaterThanOrEqual(7);
    expect(minOf(CLEAN_TITLES)).toBeGreaterThanOrEqual(7);
    expect(minOf(VERDICTS)).toBeGreaterThanOrEqual(10);
    expect(GREETINGS.length).toBeGreaterThanOrEqual(20);
    expect(CLOSINGS.length).toBeGreaterThanOrEqual(20);
    expect(OPENINGS.length).toBeGreaterThanOrEqual(20);
    expect(HIGHLIGHTS.length).toBeGreaterThanOrEqual(14);
    expect(BEST_BOASTS.length).toBeGreaterThanOrEqual(14);
    expect(BUTS.length).toBeGreaterThanOrEqual(130);
  });

  it("同じ話題の中に、同じ文が2つ無い", () => {
    const v = allValues[0];
    for (const [name, table] of tables) {
      for (const [key, lines] of Object.entries(table)) {
        const rendered = lines.map((line) => line(v));
        expect(new Set(rendered).size, `${name}.${key}`).toBe(rendered.length);
      }
    }
    for (const [key, list] of [...Object.entries(TITLES), ...Object.entries(CLEAN_TITLES)]) expect(new Set(list).size, key).toBe(list.length);
    // 称号は、ちがう話題どうしでもかぶらない(どの弱みの称号か分からなくなるため)
    const titles = Object.values(TITLES).flat();
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("文の中身", () => {
  it("どの人の数字を入れても、差し込みに失敗した跡が残らず、長すぎない", () => {
    for (const v of allValues) {
      for (const [name, line] of everyLine) {
        const text = line(v);
        expect(text.length, name).toBeGreaterThan(0);
        expect(text.length, `${name}: ${text}`).toBeLessThanOrEqual(120);
        expect(text, name).not.toMatch(/undefined|NaN|null|Infinity|\[object/);
      }
    }
  });

  it("組み立てた文には、罵倒語・容姿や性別への言及・実在の人の名前を入れない(口ぐせは別の表が出典つきで足す)", () => {
    // 「カスタム」「〜とばかり」「男です(自分のこと)」のような語は引っかけない
    const banned = /バカ|馬鹿|カス(?!タム)|雑魚|ザコ|ゴミ|クソ|アホ|ボケ|しね|死ね|デブ|ブス|ババア|女|らいじん|Zerost|スタンミ|葛葉|釈迦/;
    const v = allValues[0];
    for (const [name, line] of everyLine) {
      // 自己紹介の呼びかけ(「らいじんさん、」)だけは評価役の名前が入る
      if (name === "GREETINGS") continue;
      expect(line(v), name).not.toMatch(banned);
    }
    for (const [name, text] of fixedTexts) expect(text, name).not.toMatch(banned);
  });

  it("総評には総合点と評価の文字が入り、最初のひとことには名前が入る", () => {
    const v = allValues[0];
    for (const [grade, lines] of Object.entries(VERDICTS)) {
      for (const line of lines) {
        expect(line(v), grade).toContain(`${v.overall}点`);
        expect(line(v), grade).toContain(grade);
      }
    }
    for (const line of OPENINGS) expect(line(v)).toContain(v.name);
    for (const line of GREETINGS) expect(line(v)).toContain(v.name);
  });

  it("良かった試合へのひとことは、その試合に勝ったとは言わない(負け試合のこともある)", () => {
    for (const line of HIGHLIGHTS) expect(line(allValues[0])).not.toMatch(/勝っ|勝ち|勝利/);
  });
});

describe("BUTS(強みを認めたあとの「ただし」)", () => {
  it("同じ強み×弱みの組は1つだけ", () => {
    const keys = BUTS.map((b) => `${b.strength}×${b.weakness}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("同時には成り立たない組が無い", () => {
    const impossible = ["lanewin×behind15", "form×slump", "lategame×latelose", "survive×feeder", "winrate×losing", "cs×lowcs", "vision×blind", "teamfight×afk", "damage×lowdamage", "comeback×thrower-never"];
    const keys = new Set(BUTS.map((b) => `${b.strength}×${b.weakness}`));
    for (const key of impossible) expect(keys.has(key), key).toBe(false);
  });
});

describe("組み立ての変化(つなぎ・自慢の試合・ところで・称号の枕ことば)", () => {
  const build = (id: string, variant: number) => {
    const player = samplePlayer(id)!;
    const analysis = analyze(player, JST)!;
    const intro = buildIntro(player, analysis, { variant });
    return { analysis, intro, review: buildReview(player, analysis, intro, { variant }) };
  };

  it("自己紹介の1つ目にはつなぎを置かず、2つ目からは表のどれかを置く", () => {
    for (const s of SAMPLE_PLAYERS) {
      for (let variant = 0; variant < 10; variant++) {
        const { intro } = build(s.id, variant);
        expect(intro.claims[0].lead).toBe("");
        for (const claim of intro.claims.slice(1)) expect(CONNECTORS).toContain(claim.lead);
      }
    }
  });

  it("自己紹介の最後に、いちばん良かった試合を自分から持ち出す", () => {
    for (const s of SAMPLE_PLAYERS) {
      const { analysis, intro } = build(s.id, 0);
      expect(intro.bestBoast).toContain(analysis.detail.bestGame.champion);
      expect(intro.bestBoast).toContain(`${analysis.detail.bestGame.kills}/${analysis.detail.bestGame.deaths}/${analysis.detail.bestGame.assists}`);
    }
  });

  it("「ところで」は必ず1つ出て、どの人でも条件に合うものが少なくとも1つある", () => {
    for (const s of SAMPLE_PLAYERS) for (let variant = 0; variant < 10; variant++) expect(build(s.id, variant).review.note.length).toBeGreaterThan(10);
    for (const p of players) {
      const a = analyze(p, JST)!;
      expect(NOTES.filter((n) => n.when(a, () => false)).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("「ところで」は、もう弱みとして話に出ていることを繰り返さない", () => {
    // mid-feeder は marathon(連戦)・nightloss(深夜)・ff(降参)・pinger(ピン)の弱みがある
    const notes = Array.from({ length: 40 }, (_, variant) => build("mid-feeder", variant).review.note).join("\n");
    expect(notes).not.toMatch(/連戦|深夜|降参|ピン/);
  });

  it("「ところで」は言い直すと変わる", () => {
    for (const s of SAMPLE_PLAYERS) {
      const seen = new Set(Array.from({ length: 30 }, (_, variant) => build(s.id, variant).review.note));
      expect(seen.size, s.id).toBeGreaterThanOrEqual(4);
    }
  });

  it("称号には枕ことばが付くことがある(弱みから付いた称号にだけ)", () => {
    const all = Object.values(TITLES).flat();
    const titles = Array.from({ length: 40 }, (_, variant) => build("mid-feeder", variant).review.title);
    expect(titles.some((t) => TITLE_PREFIXES.some((p) => t.startsWith(p)))).toBe(true);
    expect(titles.some((t) => all.includes(t))).toBe(true);
    for (const t of titles) expect(all.some((base) => t === base || TITLE_PREFIXES.some((p) => t === `${p}${base}`)), t).toBe(true);
    // 弱みのない人の称号には付けない
    const clean = Object.values(CLEAN_TITLES).flat();
    for (let variant = 0; variant < 20; variant++) expect(clean).toContain(build("jg-solid", variant).review.title);
  });

  it("同じ成績でも、名前がちがえば称号と頭に付く口ぐせがそろいにくい", () => {
    const base = samplePlayer("mid-feeder")!;
    const titles = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      const player = { ...base, gameName: `ひと${i}` };
      const analysis = analyze(player, JST)!;
      const title = buildReview(player, analysis, buildIntro(player, analysis)).title;
      titles.set(title, (titles.get(title) ?? 0) + 1);
    }
    // 称号7つ × 枕ことばの有無で、いちばん多い称号でも全体の1割ほど
    expect(titles.size).toBeGreaterThanOrEqual(30);
    expect(Math.max(...titles.values())).toBeLessThanOrEqual(30);
  });

  it("表には、変化が出るだけの数がある", () => {
    expect(NOTES.length).toBeGreaterThanOrEqual(15);
    expect(TITLE_PREFIXES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CONNECTORS).size).toBeGreaterThanOrEqual(8);
  });
});

describe("バリエーション", () => {
  const render = (id: string, variant: number): string => {
    const player = samplePlayer(id)!;
    const analysis = analyze(player, JST)!;
    const intro = buildIntro(player, analysis, { variant });
    const review = buildReview(player, analysis, intro, { variant });
    return [intro.greeting, ...intro.claims.map((c) => `${c.lead}${c.text}`), intro.bestBoast, intro.closing, review.opening, ...review.replies.map((r) => r.text),
      ...review.roasts.map((r) => r.text), review.highlight, review.note, review.title, review.verdict, review.homework].join("\n");
  };

  it("200回言い直して、同じ文章が一度も出ない", () => {
    for (const s of SAMPLE_PLAYERS) {
      const seen = new Set(Array.from({ length: 200 }, (_, variant) => render(s.id, variant)));
      expect(seen.size, s.id).toBe(200);
    }
  });

  it("1つの吹き出しだけを見ても、言い直すとよく変わる", () => {
    const player = samplePlayer("mid-feeder")!;
    const analysis = analyze(player, JST)!;
    const parts = { greeting: new Set<string>(), closing: new Set<string>(), opening: new Set<string>(), verdict: new Set<string>(), best: new Set<string>(), highlight: new Set<string>() };
    for (let variant = 0; variant < 200; variant++) {
      const intro = buildIntro(player, analysis, { variant });
      const review = buildReview(player, analysis, intro, { variant });
      parts.greeting.add(intro.greeting); parts.closing.add(intro.closing); parts.best.add(intro.bestBoast);
      parts.opening.add(review.opening); parts.verdict.add(review.verdict); parts.highlight.add(review.highlight);
    }
    expect(parts.greeting.size).toBeGreaterThanOrEqual(18);
    expect(parts.closing.size).toBeGreaterThanOrEqual(18);
    expect(parts.opening.size).toBeGreaterThanOrEqual(18);
    expect(parts.verdict.size).toBeGreaterThanOrEqual(9);
    expect(parts.best.size).toBeGreaterThanOrEqual(12);
    expect(parts.highlight.size).toBeGreaterThanOrEqual(12);
  });

  it("言い直すと、取り上げる話題・称号・宿題も変わる", () => {
    const player = samplePlayer("mid-feeder")!;
    const analysis = analyze(player, JST)!;
    const topics = new Set<string>();
    const titles = new Set<string>();
    const homework = new Set<string>();
    for (let variant = 0; variant < 40; variant++) {
      const intro = buildIntro(player, analysis, { variant });
      const review = buildReview(player, analysis, intro, { variant });
      for (const c of intro.claims) topics.add(c.topic);
      for (const r of review.roasts) topics.add(r.topic);
      titles.add(review.title);
      homework.add(review.homework);
    }
    // 弱みが13個ある人なので、最初の1回(上位だけ)より多くの話題に触れる
    expect(topics.size).toBeGreaterThanOrEqual(10);
    expect(titles.size).toBeGreaterThanOrEqual(6);
    expect(homework.size).toBeGreaterThanOrEqual(5);
  });

  it("最初の1回は、いちばん目立つ強み・弱みを取り上げる", () => {
    const player = samplePlayer("jg-solid")!;
    const analysis = analyze(player, JST)!;
    const intro = buildIntro(player, analysis);
    expect(intro.claims.map((c) => c.topic)).toEqual(analysis.strengths.slice(0, 3).map((t) => t.id));
  });
});
