import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { computeDetail, scoreMatch, winRateOf } from "../lol/src/detail";
import type { MatchStat } from "../lol/src/types";
import { match, player, series, timeline } from "./lol-helpers";

const JST = 540;
const detailOf = (matches: MatchStat[]) => computeDetail(matches, matches, "MIDDLE", JST);
const ids = (traits: readonly { id: string }[]) => traits.map((t) => t.id);
const run = (matches: MatchStat[]) => analyze(player(matches), { utcOffsetMinutes: JST })!;
/** 日本時間の hour 時ちょうどに始まる時刻 */
const at = (day: number, hour: number): number => Date.UTC(2026, 0, day, hour - 9);

describe("winRateOf", () => {
  it("試合がなければ0", () => {
    expect(winRateOf({ games: 0, wins: 0 })).toBe(0);
    expect(winRateOf({ games: 4, wins: 1 })).toBe(0.25);
  });
});

describe("scoreMatch", () => {
  it("内容の良い試合ほど高く、0〜100におさまる", () => {
    const good = scoreMatch(match({ kills: 12, deaths: 1, assists: 10, cs: 260, damage: 30000, visionScore: 45 }));
    const bad = scoreMatch(match({ win: false, kills: 1, deaths: 12, assists: 2, cs: 100, damage: 7000, visionScore: 8 }));
    expect(good).toBeGreaterThan(scoreMatch(match()));
    expect(scoreMatch(match())).toBeGreaterThan(bad);
    for (const s of [good, bad]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("サポートはCSが少なくても点が下がらない", () => {
    const support = { role: "UTILITY" as const, visionScore: 75, kills: 1, assists: 16, damage: 9000 };
    expect(scoreMatch(match({ ...support, cs: 20 }))).toBe(scoreMatch(match({ ...support, cs: 200 })));
  });
});

describe("computeDetail: 条件別の勝率", () => {
  it("サイド・長さ・種類ごとに数える", () => {
    const d = detailOf(
      series([
        { side: "blue", win: true, durationSec: 20 * 60, queueId: 420 },
        { side: "blue", win: false, durationSec: 30 * 60, queueId: 440 },
        { side: "red", win: false, durationSec: 40 * 60, queueId: 400 },
      ]),
    );
    expect(d.side).toEqual({ blue: { games: 2, wins: 1 }, red: { games: 1, wins: 0 } });
    expect(d.length).toEqual({ short: { games: 1, wins: 1 }, mid: { games: 1, wins: 0 }, long: { games: 1, wins: 0 } });
    expect(d.queue).toEqual({ ranked: { games: 2, wins: 1 }, normal: { games: 1, wins: 0 } });
  });

  it("始めた時刻は、渡した時差で朝・昼・夜・深夜に分ける", () => {
    const d = detailOf([
      match({ gameStart: at(4, 2), win: false }),
      match({ gameStart: at(3, 21) }),
      match({ gameStart: at(2, 13) }),
      match({ gameStart: at(1, 7) }),
    ]);
    expect(d.time).toEqual({
      morning: { games: 1, wins: 1 },
      day: { games: 1, wins: 1 },
      evening: { games: 1, wins: 1 },
      night: { games: 1, wins: 0 },
    });
    // 時差を変えると、同じ試合が別の時間帯になる
    expect(computeDetail([match({ gameStart: at(4, 2) })], [], "MIDDLE", 0).time.evening.games).toBe(1);
  });

  it("直近5試合と、それより前に分ける", () => {
    const d = detailOf(series([{ win: false }, { win: false }, { win: false }, { win: false }, { win: true }, { win: true }, { win: true }]));
    expect(d.recent).toEqual({ games: 5, wins: 1 });
    expect(d.earlier).toEqual({ games: 2, wins: 2 });
  });
});

describe("computeDetail: 連戦", () => {
  it("前の試合が終わって20分以内に始めた試合を、前の勝ち負けで分ける", () => {
    // 新しい順: 負 ← 負 ← 勝 ← 負(いちばん古い)。すべて5分後に次を始めている
    const d = detailOf(series([{ win: false }, { win: false }, { win: true }, { win: false }], 5));
    expect(d.afterLoss).toEqual({ games: 2, wins: 1 });
    expect(d.afterWin).toEqual({ games: 1, wins: 0 });
    expect(d.longestSession).toBe(4);
  });

  it("あいだが空いた試合は連戦に数えない", () => {
    const d = detailOf(series([{ win: false }, { win: false }, { win: false }], 180));
    expect(d.afterLoss.games).toBe(0);
    expect(d.longestSession).toBe(1);
  });

  it("30分以内なら連戦、20分を超えると「直後」には数えない", () => {
    const d = detailOf(series([{ win: true }, { win: false }], 25));
    expect(d.longestSession).toBe(2);
    expect(d.afterLoss.games).toBe(0);
  });
});

describe("computeDetail: 対面との差とデスの内訳", () => {
  it("対面との差は、取れた試合だけで平均する", () => {
    const d = detailOf([
      match({ goldDiff: 1000, csDiff: 20, laneWon: true, timeline: timeline({ goldDiff15: 800, goldDiff10: 400, csDiff10: 10, takedowns10: 2 }) }),
      match({ goldDiff: -200, csDiff: -4, laneWon: false, timeline: timeline({ goldDiff15: null, goldDiff10: 0, csDiff10: null, takedowns10: 0 }) }),
      match({ goldDiff: null, csDiff: null, damageDiff: null, laneWon: null, timeline: null }),
    ]);
    expect(d.lane.games).toBe(2);
    expect(d.lane.wonRate).toBe(0.5);
    expect(d.lane.goldDiff).toBe(400);
    expect(d.lane.csDiff).toBe(8);
    expect(d.lane.goldDiff15).toBe(800);
    expect(d.lane.goldDiff10).toBe(200);
    expect(d.lane.csDiff10).toBe(10);
    expect(d.lane.takedowns10).toBe(1);
  });

  it("対面との差がひとつも取れなければ null", () => {
    const d = detailOf([match({ goldDiff: null, csDiff: null, laneWon: null, timeline: null })]);
    expect(d.lane).toEqual({ games: 0, wonRate: null, csDiff: null, goldDiff: null, csDiff10: null, goldDiff10: null, goldDiff15: null, takedowns10: null });
    expect(d.deaths).toBeNull();
  });

  it("デスを序盤・中盤・終盤に分け、1対1と相手陣地の割合を出す", () => {
    const d = detailOf([
      match({ timeline: timeline({ deathMinutes: [3, 7, 10, 18], soloDeaths: 2, deepDeaths: 1 }) }),
      match({ timeline: timeline({ deathMinutes: [26, 31, 12, 9.9], soloDeaths: 0, deepDeaths: 3 }) }),
      match({ timeline: null }),
    ]);
    expect(d.deaths).toEqual({ counted: 8, per10: 2, early: 0.5, mid: 0.25, late: 0.25, solo: 0.25, deep: 0.5 });
  });

  it("15分で1000ゴールド以上の差がついた試合を、リードとビハインドに分ける", () => {
    const d = detailOf([
      match({ win: false, timeline: timeline({ goldDiff15: 1500 }) }),
      match({ win: true, timeline: timeline({ goldDiff15: 1000 }) }),
      match({ win: true, timeline: timeline({ goldDiff15: -1200 }) }),
      match({ win: true, timeline: timeline({ goldDiff15: 300 }) }),
      match({ win: true, timeline: null }),
    ]);
    expect(d.ahead15).toEqual({ games: 2, wins: 1 });
    expect(d.behind15).toEqual({ games: 1, wins: 1 });
  });

  it("オブジェクト関与の割合は1を超えない", () => {
    expect(detailOf([match({ objectives: 6, teamObjectives: 4 })]).objectiveShare).toBe(1);
    expect(detailOf([match({ objectives: 1, teamObjectives: 4 })]).objectiveShare).toBe(0.25);
    expect(detailOf([match({ objectives: 0, teamObjectives: 0 })]).objectiveShare).toBe(0);
  });

  it("試合ごとの出来を並べ、いちばん良い試合を選ぶ", () => {
    const best = match({ matchId: "BEST", kills: 15, deaths: 0, assists: 12, cs: 270, damage: 33000 });
    const d = detailOf([match(), best, match({ win: false, deaths: 11 })]);
    expect(d.scores).toHaveLength(3);
    expect(d.bestGame.matchId).toBe("BEST");
  });

  it("両方のサイドに5試合以上あって勝率が大きくちがうときだけ、苦手な側を出す", () => {
    const blue = Array.from({ length: 5 }, () => ({ side: "blue" as const, win: true }));
    const red = Array.from({ length: 5 }, (_, i) => ({ side: "red" as const, win: i === 0 }));
    expect(detailOf(series([...blue, ...red])).weakSide).toBe("red");
    expect(detailOf(series([...blue, ...red.slice(0, 4)])).weakSide).toBeNull();
    expect(detailOf(series([...blue, ...blue.map((m) => ({ ...m, side: "red" as const }))])).weakSide).toBeNull();
  });
});

describe("analyze: くわしい解析から出る強み・弱み", () => {
  const twelve = (over: (i: number) => Partial<MatchStat>, gap = 180) => series(Array.from({ length: 12 }, (_, i) => over(i)), gap);

  it("15分でいつも負けている人は behind15、勝っている人は lanewin", () => {
    expect(ids(run(twelve(() => ({ timeline: timeline({ goldDiff15: -900 }) }))).weaknesses)).toContain("behind15");
    const ahead = run(twelve(() => ({ laneWon: true, timeline: timeline({ goldDiff15: 900 }) })));
    expect(ids(ahead.strengths)).toContain("lanewin");
    expect(ids(ahead.weaknesses)).not.toContain("behind15");
  });

  it("10分までに何度も死ぬ人は earlydeath", () => {
    const a = run(twelve(() => ({ timeline: timeline({ deathMinutes: [3, 6, 9, 20, 25] }) })));
    expect(ids(a.weaknesses)).toContain("earlydeath");
    expect(a.detail.deaths?.per10).toBe(3);
  });

  it("相手陣地でのデスや1対1のデスが多い人を見つける", () => {
    const a = run(twelve(() => ({ timeline: timeline({ soloDeaths: 3, deepDeaths: 4 }) })));
    expect(ids(a.weaknesses)).toEqual(expect.arrayContaining(["deepdeath", "solodeath"]));
  });

  it("リードした試合を落とす人は thrower、ビハインドから勝つ人は comeback", () => {
    const thrower = run(twelve((i) => ({ win: i >= 4, timeline: timeline({ goldDiff15: i < 4 ? 1500 : 0 }) })));
    expect(ids(thrower.weaknesses)).toContain("thrower");
    const comeback = run(twelve((i) => ({ win: true, timeline: timeline({ goldDiff15: i < 3 ? -1500 : 0 }) })));
    expect(ids(comeback.strengths)).toContain("comeback");
  });

  it("負けた直後に続けて負ける人は tilt、6連戦以上は marathon", () => {
    const a = run(twelve((i) => ({ win: i >= 8 }), 5));
    expect(ids(a.weaknesses)).toEqual(expect.arrayContaining(["tilt", "marathon"]));
    expect(a.detail.longestSession).toBe(12);
    const rested = run(twelve((i) => ({ win: i >= 8 }), 600));
    expect(ids(rested.weaknesses)).not.toContain("tilt");
    expect(ids(rested.weaknesses)).not.toContain("marathon");
  });

  it("深夜に負けが込む人は nightloss", () => {
    const a = run(Array.from({ length: 10 }, (_, i) => match({ gameStart: at(20 - i, i < 5 ? 2 : 20), win: i >= 5 })));
    expect(ids(a.weaknesses)).toContain("nightloss");
    expect(a.detail.time.night).toEqual({ games: 5, wins: 0 });
  });

  it("降参の多い人は ff、「?」ピンの多い人は pinger", () => {
    const a = run(twelve((i) => ({ win: i >= 5, surrendered: i < 3, missingPings: 12, pings: 40 })));
    expect(ids(a.weaknesses)).toEqual(expect.arrayContaining(["ff", "pinger"]));
  });

  it("直近だけ勝てていない人は slump、直近だけ勝っている人は form", () => {
    expect(ids(run(twelve((i) => ({ win: i >= 5 }))).weaknesses)).toContain("slump");
    const hot = run(twelve((i) => ({ win: i < 5 || i % 2 === 0 })));
    expect(ids(hot.strengths)).toContain("form");
    expect(ids(hot.weaknesses)).not.toContain("slump");
  });

  it("長い試合に弱い人は latelose、強い人は lategame", () => {
    const long = { durationSec: 40 * 60, cs: 250, gold: 15000 };
    expect(ids(run(twelve((i) => (i < 5 ? { ...long, win: false } : {}))).weaknesses)).toContain("latelose");
    expect(ids(run(twelve((i) => (i < 5 ? { ...long, win: true } : { win: i % 2 === 0 }))).strengths)).toContain("lategame");
  });

  it("勝てていないチャンピオンを使い続ける人は badchamp", () => {
    const a = run(twelve((i) => (i < 4 ? { champion: "Yasuo", win: false } : { champion: "Ahri", win: true })));
    expect(ids(a.weaknesses)).toContain("badchamp");
    expect(a.badChampion?.champion).toBe("Yasuo");
    // 全体が負けているだけなら、チャンピオンのせいにしない
    expect(run(twelve(() => ({ champion: "Yasuo", win: false }))).badChampion).toBeNull();
  });

  it("サイドで勝率が大きくちがう人は sidegap", () => {
    const a = run(twelve((i) => ({ side: i < 6 ? "blue" : "red", win: i < 6 })));
    expect(ids(a.weaknesses)).toContain("sidegap");
    expect(a.detail.weakSide).toBe("red");
  });

  it("プレート・CC・回避・スティールの強みを拾う", () => {
    const a = run(twelve(() => ({ turretPlates: 3, ccSec: 50, skillshotsDodged: 70, epicSteals: 1 })));
    expect(ids(a.strengths)).toEqual(expect.arrayContaining(["plates", "cc", "dodger", "steal"]));
  });

  it("回復の強みはサポートだけ、プレートの強みはレーナーだけ", () => {
    const support = run(twelve(() => ({ role: "UTILITY", healShield: 12000, turretPlates: 3 })));
    expect(ids(support.strengths)).toContain("healer");
    expect(ids(support.strengths)).not.toContain("plates");
    expect(ids(run(twelve(() => ({ healShield: 12000 }))).strengths)).not.toContain("healer");
  });

  it("タイムラインがひとつも無くても落ちない", () => {
    const a = run(twelve(() => ({ timeline: null, goldDiff: null, csDiff: null, damageDiff: null, laneWon: null })));
    expect(a.detail.deaths).toBeNull();
    for (const id of ["behind15", "earlydeath", "deepdeath", "solodeath", "thrower"]) expect(ids(a.weaknesses)).not.toContain(id);
  });
});
