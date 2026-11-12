import { describe, expect, it } from "vitest";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";
import type { MatchStat, MatchTimeline, PlayerData, Role } from "../lol/src/types";

const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM"];

const load = (id: string): PlayerData => {
  const p = samplePlayer(id);
  if (!p) throw new Error(`サンプル ${id} がありません`);
  return p;
};
const sum = <M extends MatchStat>(ms: M[], pick: (m: M) => number) => ms.reduce((n, m) => n + pick(m), 0);
const minutesOf = (ms: MatchStat[]) => sum(ms, (m) => m.durationSec) / 60;
const mainRole = (ms: MatchStat[]) =>
  ROLES.map((role) => ({ role, n: ms.filter((m) => m.role === role).length })).sort((a, b) => b.n - a.n)[0];

const average = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;
const present = <T>(xs: (T | null)[]) => xs.filter((x): x is T => x !== null);
/** タイムラインが取れた試合だけ */
const withTimeline = (ms: MatchStat[]) =>
  ms.filter((m): m is MatchStat & { timeline: MatchTimeline } => m.timeline !== null);

/** 20試合をまとめた、くわしい解析で見そうな数字 */
const detailSummary = (id: string) => {
  const ms = load(id).matches;
  const timed = withTimeline(ms);
  const timedDeaths = sum(timed, (m) => m.deaths);
  const losses = ms.filter((m) => !m.win);
  const laneKnown = present(ms.map((m) => m.laneWon));
  return {
    csDiff: average(present(ms.map((m) => m.csDiff))),
    goldDiff: average(present(ms.map((m) => m.goldDiff))),
    laneWinRate: laneKnown.filter(Boolean).length / laneKnown.length,
    turretPlates: sum(ms, (m) => m.turretPlates) / ms.length,
    objectiveDamage: sum(ms, (m) => m.objectiveDamage) / ms.length,
    objectiveShare: sum(ms, (m) => m.objectives) / sum(ms, (m) => m.teamObjectives),
    healShield: sum(ms, (m) => m.healShield) / ms.length,
    epicSteals: sum(ms, (m) => m.epicSteals),
    missingPings: sum(ms, (m) => m.missingPings) / ms.length,
    surrenderRate: losses.filter((m) => m.surrendered).length / losses.length,
    longestLiving: sum(ms, (m) => m.longestLivingSec) / sum(ms, (m) => m.durationSec),
    earlyDeathShare: sum(timed, (m) => m.timeline.deathMinutes.filter((t) => t < 10).length) / timedDeaths,
    soloDeathShare: sum(timed, (m) => m.timeline.soloDeaths) / timedDeaths,
    deepDeathShare: sum(timed, (m) => m.timeline.deepDeaths) / timedDeaths,
    goldDiff15: average(present(timed.map((m) => m.timeline.goldDiff15))),
    csDiff10: average(present(timed.map((m) => m.timeline.csDiff10))),
  };
};

/** 20試合をまとめた、診断で見そうな数字 */
const summary = (id: string) => {
  const ms = load(id).matches;
  const min = minutesOf(ms);
  return {
    winRate: ms.filter((m) => m.win).length / ms.length,
    deaths: sum(ms, (m) => m.deaths) / ms.length,
    kda: sum(ms, (m) => m.kills + m.assists) / sum(ms, (m) => m.deaths),
    csPerMin: sum(ms, (m) => m.cs) / min,
    visionPerMin: sum(ms, (m) => m.visionScore) / min,
    kp: sum(ms, (m) => m.kills + m.assists) / sum(ms, (m) => m.teamKills),
    dmgShare: sum(ms, (m) => m.damage) / sum(ms, (m) => m.teamDamage),
    controlWards: sum(ms, (m) => m.controlWards) / ms.length,
  };
};

describe("サンプルの一覧", () => {
  it("5人ぶんあり、id が重複せず、ラベルと説明がある", () => {
    expect(SAMPLE_PLAYERS).toHaveLength(5);
    expect(new Set(SAMPLE_PLAYERS.map((s) => s.id)).size).toBe(5);
    for (const s of SAMPLE_PLAYERS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
    }
  });

  it("知らない id は null", () => {
    expect(samplePlayer("no-such-sample")).toBeNull();
    expect(samplePlayer("")).toBeNull();
  });

  it("名前はサンプルと分かるもので、互いに重複しない", () => {
    const names = SAMPLE_PLAYERS.map((s) => load(s.id).gameName);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/サンプル|さんぷる/);
  });
});

describe.each(SAMPLE_PLAYERS)("サンプル: $label", ({ id }) => {
  const player = load(id);
  const ms = player.matches;

  it("サンプルの印・タグ・レベル・ランクが入っている", () => {
    expect(player.sample).toBe(true);
    expect(player.tagLine).toBe("DEMO");
    expect(player.level).toBeGreaterThanOrEqual(30);
    expect(player.rank).not.toBeNull();
    expect(TIERS).toContain(player.rank?.tier);
    expect(["I", "II", "III", "IV"]).toContain(player.rank?.division);
    expect(player.rank?.lp).toBeGreaterThanOrEqual(0);
    expect(player.rank?.lp).toBeLessThan(100);
    expect(player.rank?.wins).toBeGreaterThan(0);
    expect(player.rank?.losses).toBeGreaterThan(0);
  });

  it("20試合あり、試合IDは DEMO_ で始まり重複しない", () => {
    expect(ms).toHaveLength(20);
    expect(new Set(ms.map((m) => m.matchId)).size).toBe(20);
    for (const m of ms) expect(m.matchId).toMatch(/^DEMO_\d+$/);
  });

  it("何度呼んでも同じ内容で、返した値を書き換えても次に響かない", () => {
    const first = load(id);
    expect(load(id)).toEqual(first);
    first.matches[0].kills = 999;
    first.matches.pop();
    if (first.rank) first.rank.lp = -1;
    expect(load(id)).toEqual(player);
  });

  it("新しい順に並び、前の試合が終わってから次が始まる", () => {
    for (let i = 1; i < ms.length; i++) {
      const gap = ms[i - 1].gameStart - ms[i].gameStart;
      expect(gap).toBeGreaterThan(ms[i].durationSec * 1000);
      // 3日以上あくことはない
      expect(gap).toBeLessThan(3 * 24 * 60 * 60 * 1000);
    }
  });

  it("キューはランクが中心で、ロールはメインが中心", () => {
    for (const m of ms) expect([420, 440, 400]).toContain(m.queueId);
    expect(ms.filter((m) => m.queueId === 420).length).toBeGreaterThanOrEqual(12);
    expect(ms.filter((m) => m.queueId !== 420).length).toBeGreaterThanOrEqual(2);
    for (const m of ms) expect(ROLES).toContain(m.role);
    const off = ms.length - mainRole(ms).n;
    expect(off).toBeGreaterThanOrEqual(1);
    expect(off).toBeLessThanOrEqual(3);
  });

  it("チャンピオンは2〜6体で、IDは英数字だけ", () => {
    const champions = new Set(ms.map((m) => m.champion));
    expect(champions.size).toBeGreaterThanOrEqual(2);
    expect(champions.size).toBeLessThanOrEqual(6);
    for (const c of champions) expect(c).toMatch(/^[A-Z][A-Za-z]+$/);
  });

  it("どの数値も整数で負にならない", () => {
    const keys = [
      "queueId", "gameStart", "durationSec", "kills", "deaths", "assists", "cs", "gold", "damage", "damageTaken",
      "visionScore", "wardsPlaced", "wardsKilled", "controlWards", "teamKills", "teamDamage", "soloKills",
      "objectives", "turretTakedowns", "largestMultiKill", "timeDeadSec",
      "level", "turretPlates", "objectiveDamage", "teamObjectives", "healShield", "ccSec", "skillshotsDodged",
      "epicSteals", "pings", "missingPings", "longestLivingSec",
    ] as const;
    for (const m of ms) {
      for (const key of keys) {
        expect(Number.isInteger(m[key]), `${m.matchId} ${key}`).toBe(true);
        expect(m[key], `${m.matchId} ${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("キル・ダメージがチーム合計を超えない", () => {
    for (const m of ms) {
      expect(m.kills + m.assists).toBeLessThanOrEqual(m.teamKills);
      expect(m.damage).toBeLessThanOrEqual(m.teamDamage);
      const share = m.damage / m.teamDamage;
      expect(share).toBeGreaterThanOrEqual(0.1);
      expect(share).toBeLessThanOrEqual(0.35);
      expect(m.soloKills).toBeLessThanOrEqual(m.kills);
      expect(m.largestMultiKill).toBeLessThanOrEqual(Math.min(5, m.kills));
      if (m.kills > 0) expect(m.largestMultiKill).toBeGreaterThanOrEqual(1);
      if (m.firstBlood) expect(m.kills + m.assists).toBeGreaterThan(0);
    }
  });

  it("試合時間・ゴールド・視界・オブジェクトが現実的な範囲にある", () => {
    for (const m of ms) {
      const min = m.durationSec / 60;
      expect(m.durationSec).toBeGreaterThanOrEqual(1200);
      expect(m.durationSec).toBeLessThanOrEqual(2400);
      expect(m.gold / min).toBeGreaterThanOrEqual(299);
      expect(m.gold / min).toBeLessThanOrEqual(481);
      expect(m.visionScore / min).toBeGreaterThanOrEqual(0.4);
      expect(m.visionScore / min).toBeLessThanOrEqual(3);
      expect(m.controlWards).toBeLessThanOrEqual(8);
      expect(m.objectives).toBeLessThanOrEqual(6);
      expect(m.turretTakedowns).toBeLessThanOrEqual(6);
      expect(m.damage).toBeGreaterThan(0);
      expect(m.damageTaken).toBeGreaterThan(0);
    }
  });

  it("CSがロールに見合っていて、10分CSは一部だけ null", () => {
    for (const m of ms) {
      const perMin = m.cs / (m.durationSec / 60);
      if (m.role === "UTILITY") {
        expect(perMin).toBeLessThan(2);
      } else {
        expect(perMin).toBeGreaterThanOrEqual(4.5);
        expect(perMin).toBeLessThanOrEqual(9.5);
      }
      if (m.csAt10 === null) continue;
      expect(m.csAt10).toBeLessThanOrEqual(m.cs);
      if (m.role === "UTILITY") {
        expect(m.csAt10).toBeLessThanOrEqual(20);
      } else {
        expect(m.csAt10).toBeGreaterThanOrEqual(40);
        expect(m.csAt10).toBeLessThanOrEqual(100);
      }
    }
    const missing = ms.filter((m) => m.csAt10 === null).length;
    expect(missing).toBeGreaterThanOrEqual(1);
    expect(missing).toBeLessThanOrEqual(2);
  });

  it("死んでいた時間がデス数に見合っている", () => {
    for (const m of ms) {
      if (m.deaths === 0) {
        expect(m.timeDeadSec).toBe(0);
        continue;
      }
      const perDeath = m.timeDeadSec / m.deaths;
      expect(perDeath).toBeGreaterThanOrEqual(25);
      expect(perDeath).toBeLessThanOrEqual(45.5);
      expect(m.timeDeadSec).toBeLessThan(m.durationSec / 2);
    }
  });

  it("勝率が35〜65%におさまる", () => {
    const winRate = ms.filter((m) => m.win).length / ms.length;
    expect(winRate).toBeGreaterThanOrEqual(0.35);
    expect(winRate).toBeLessThanOrEqual(0.65);
  });

  it("サイドはほぼ半々で、レベルは11〜18で試合が長いほど高い", () => {
    for (const m of ms) {
      expect(["blue", "red"]).toContain(m.side);
      expect(m.level).toBeGreaterThanOrEqual(11);
      expect(m.level).toBeLessThanOrEqual(18);
    }
    const blue = ms.filter((m) => m.side === "blue").length;
    expect(blue).toBeGreaterThanOrEqual(8);
    expect(blue).toBeLessThanOrEqual(12);
    // 同じロールの中で、長い半分のほうが短い半分よりレベルが高い
    const main = ms.filter((m) => m.role === mainRole(ms).role).sort((a, b) => a.durationSec - b.durationSec);
    const half = Math.floor(main.length / 2);
    expect(average(main.slice(-half).map((m) => m.level))).toBeGreaterThan(average(main.slice(0, half).map((m) => m.level)));
  });

  it("対面との差は3つそろって null か整数で、null は1〜2試合", () => {
    for (const m of ms) {
      const diffs = [m.csDiff, m.goldDiff, m.damageDiff];
      expect(new Set(diffs.map((d) => d === null)).size, m.matchId).toBe(1);
      for (const d of present(diffs)) expect(Number.isInteger(d), m.matchId).toBe(true);
      if (m.csDiff === null || m.goldDiff === null || m.damageDiff === null) continue;
      expect(Math.abs(m.csDiff)).toBeLessThanOrEqual(80);
      expect(Math.abs(m.goldDiff)).toBeLessThanOrEqual(4000);
      expect(Math.abs(m.damageDiff)).toBeLessThanOrEqual(8000);
      // サポートどうしは差が小さい
      if (m.role === "UTILITY") {
        expect(Math.abs(m.csDiff)).toBeLessThanOrEqual(10);
        expect(Math.abs(m.goldDiff)).toBeLessThanOrEqual(1500);
      }
    }
    const missing = ms.filter((m) => m.csDiff === null).length;
    expect(missing).toBeGreaterThanOrEqual(1);
    expect(missing).toBeLessThanOrEqual(2);
  });

  it("レーンの勝ち負けは、10分CSが取れない試合だけ null", () => {
    for (const m of ms) expect(m.laneWon === null, m.matchId).toBe(m.csAt10 === null);
    const known = present(ms.map((m) => m.laneWon));
    expect(known.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(known.filter((won) => !won).length).toBeGreaterThanOrEqual(1);
  });

  it("プレート・オブジェクト・回復・CCがロールに見合った範囲にある", () => {
    for (const m of ms) {
      expect(m.turretPlates).toBeLessThanOrEqual(m.role === "UTILITY" ? 1 : 4);
      const [objMin, objMax] = m.role === "JUNGLE" ? [15000, 45000] : m.role === "UTILITY" ? [1000, 5000] : [3000, 15000];
      expect(m.objectiveDamage, m.matchId).toBeGreaterThanOrEqual(objMin);
      expect(m.objectiveDamage, m.matchId).toBeLessThanOrEqual(objMax);
      const [healMin, healMax] = m.role === "UTILITY" ? [4000, 14000] : [0, 2500];
      expect(m.healShield, m.matchId).toBeGreaterThanOrEqual(healMin);
      expect(m.healShield, m.matchId).toBeLessThanOrEqual(healMax);
      const [ccMin, ccMax] = m.role === "UTILITY" || m.role === "JUNGLE" ? [20, 60] : [5, 30];
      expect(m.ccSec, m.matchId).toBeGreaterThanOrEqual(ccMin);
      expect(m.ccSec, m.matchId).toBeLessThanOrEqual(ccMax);
      expect(m.skillshotsDodged).toBeGreaterThanOrEqual(10);
      expect(m.skillshotsDodged).toBeLessThanOrEqual(80);
    }
  });

  it("チームのオブジェクトは本人の関与より少なくならず、勝ち試合のほうが多い", () => {
    for (const m of ms) {
      expect(m.teamObjectives, m.matchId).toBeGreaterThanOrEqual(m.objectives);
      expect(m.teamObjectives).toBeGreaterThanOrEqual(1);
      expect(m.teamObjectives).toBeLessThanOrEqual(9);
      expect(m.epicSteals).toBeLessThanOrEqual(1);
      expect(m.epicSteals).toBeLessThanOrEqual(m.objectives);
      if (m.epicSteals > 0) expect(m.role).toBe("JUNGLE");
    }
    const typical = ms.filter((m) => m.teamObjectives >= 2 && m.teamObjectives <= 8).length;
    expect(typical).toBeGreaterThanOrEqual(18);
    const mean = (win: boolean) => average(ms.filter((m) => m.win === win).map((m) => m.teamObjectives));
    expect(mean(true)).toBeGreaterThan(mean(false));
  });

  it("ピンは15〜90で「?」ピンはその内数、降参は負け試合だけ", () => {
    for (const m of ms) {
      expect(m.pings).toBeGreaterThanOrEqual(15);
      expect(m.pings).toBeLessThanOrEqual(90);
      expect(m.missingPings, m.matchId).toBeLessThanOrEqual(m.pings);
      expect(m.missingPings).toBeLessThanOrEqual(20);
      expect(typeof m.surrendered).toBe("boolean");
      if (m.surrendered) expect(m.win, m.matchId).toBe(false);
    }
    const losses = ms.filter((m) => !m.win);
    // 降参しない負け試合もある
    expect(losses.filter((m) => m.surrendered).length).toBeLessThan(losses.length);
  });

  it("いちばん長く生きた時間が、試合時間とデス数に見合っている", () => {
    for (const m of ms) {
      expect(m.longestLivingSec, m.matchId).toBeGreaterThanOrEqual(120);
      expect(m.longestLivingSec, m.matchId).toBeLessThanOrEqual(m.durationSec);
      if (m.deaths === 0) expect(m.longestLivingSec).toBe(m.durationSec);
      else expect(m.longestLivingSec).toBeLessThan(m.durationSec);
      // 生きていた時間を(デス数+1)に分けた平均よりは長い
      expect(m.longestLivingSec + 1, m.matchId).toBeGreaterThanOrEqual((m.durationSec - m.timeDeadSec) / (m.deaths + 1));
    }
  });

  it("タイムラインは一部だけ null で、デスの時刻はデス数ぶん、時刻順に試合の中にある", () => {
    const missing = ms.filter((m) => m.timeline === null).length;
    expect(missing).toBeGreaterThanOrEqual(1);
    expect(missing).toBeLessThanOrEqual(3);
    for (const m of withTimeline(ms)) {
      const t = m.timeline;
      expect(t.deathMinutes, m.matchId).toHaveLength(m.deaths);
      t.deathMinutes.forEach((minute, i) => {
        expect(minute, m.matchId).toBeGreaterThan(1.5);
        expect(minute, m.matchId).toBeLessThan(m.durationSec / 60);
        expect(Math.round(minute * 10) / 10, m.matchId).toBe(minute);
        if (i > 0) expect(minute, m.matchId).toBeGreaterThan(t.deathMinutes[i - 1]);
      });
      // デスの合間のいちばん長いところより長くは生きていない
      const marks = [0, ...t.deathMinutes, m.durationSec / 60];
      const widest = Math.max(...marks.slice(1).map((minute, i) => minute - marks[i]));
      expect(m.longestLivingSec, m.matchId).toBeLessThanOrEqual(Math.round(widest * 60));
      for (const key of ["soloDeaths", "deepDeaths", "takedowns10"] as const) {
        expect(Number.isInteger(t[key]), `${m.matchId} ${key}`).toBe(true);
        expect(t[key], `${m.matchId} ${key}`).toBeGreaterThanOrEqual(0);
      }
      expect(t.soloDeaths, m.matchId).toBeLessThanOrEqual(m.deaths);
      expect(t.deepDeaths, m.matchId).toBeLessThanOrEqual(m.deaths);
      expect(t.takedowns10).toBeLessThanOrEqual(5);
      expect(t.takedowns10, m.matchId).toBeLessThanOrEqual(m.kills + m.assists);
      if (m.firstBlood) expect(t.takedowns10, m.matchId).toBeGreaterThanOrEqual(1);
    }
  });

  it("タイムラインの対面との差は、試合終了時の差が null の試合だけ3つとも null で、レーンの勝ち負けと合う", () => {
    const timed = withTimeline(ms);
    for (const m of timed) {
      const t = m.timeline;
      for (const d of [t.goldDiff10, t.goldDiff15, t.csDiff10]) expect(d === null, m.matchId).toBe(m.csDiff === null);
      for (const d of present([t.goldDiff10, t.goldDiff15, t.csDiff10])) expect(Number.isInteger(d), m.matchId).toBe(true);
      if (t.goldDiff10 === null || t.goldDiff15 === null || t.csDiff10 === null) continue;
      expect(Math.abs(t.goldDiff10)).toBeLessThanOrEqual(2000);
      expect(Math.abs(t.goldDiff15)).toBeLessThanOrEqual(2000);
      expect(Math.abs(t.csDiff10)).toBeLessThanOrEqual(30);
      // 10分から15分で差が広がることはあっても、桁が変わるほどは動かない
      expect(Math.abs(t.goldDiff10), m.matchId).toBeLessThanOrEqual(Math.abs(t.goldDiff15) + 150);
    }
    const gold15 = (won: boolean) => present(timed.filter((m) => m.laneWon === won).map((m) => m.timeline.goldDiff15));
    const ahead = gold15(true);
    expect(ahead.filter((d) => d > 0).length).toBeGreaterThanOrEqual(ahead.length * 0.8);
    const behind = gold15(false);
    expect(behind.filter((d) => d < 0).length).toBeGreaterThanOrEqual(behind.length * 0.8);
  });
});

describe("サンプルごとの傾向", () => {
  const all = SAMPLE_PLAYERS.map((s) => ({ id: s.id, ...summary(s.id) }));
  const others = (id: string) => all.filter((s) => s.id !== id);
  const of = (id: string) => {
    const s = all.find((x) => x.id === id);
    if (!s) throw new Error(`サンプル ${id} がありません`);
    return s;
  };

  const details = SAMPLE_PLAYERS.map((s) => ({ id: s.id, ...detailSummary(s.id) }));
  const otherDetails = (id: string) => details.filter((s) => s.id !== id);
  const detailOf = (id: string) => {
    const s = details.find((x) => x.id === id);
    if (!s) throw new Error(`サンプル ${id} がありません`);
    return s;
  };

  it("最新の試合はどのサンプルも同じ固定の時刻", () => {
    const newest = new Set(SAMPLE_PLAYERS.map((s) => load(s.id).matches[0].gameStart));
    expect(newest.size).toBe(1);
  });

  it("突撃ミッドはデスがいちばん多く、KDAがいちばん低い", () => {
    const me = of("mid-feeder");
    expect(mainRole(load("mid-feeder").matches).role).toBe("MIDDLE");
    expect(me.deaths).toBeGreaterThan(8);
    for (const o of others("mid-feeder")) {
      expect(me.deaths).toBeGreaterThan(o.deaths);
      expect(me.kda).toBeLessThan(o.kda);
    }
    expect(me.winRate).toBeLessThan(0.5);
  });

  it("農家トップはCSがいちばん多く、キル関与率がいちばん低い", () => {
    const me = of("top-farmer");
    expect(mainRole(load("top-farmer").matches).role).toBe("TOP");
    expect(me.csPerMin).toBeGreaterThan(8);
    expect(me.kp).toBeLessThan(0.35);
    for (const o of others("top-farmer")) {
      expect(me.csPerMin).toBeGreaterThan(o.csPerMin);
      expect(me.kp).toBeLessThan(o.kp);
    }
  });

  it("ワードを置かないADCは視界がいちばん低く、火力はいちばん高い", () => {
    const me = of("adc-noward");
    expect(mainRole(load("adc-noward").matches).role).toBe("BOTTOM");
    expect(me.visionPerMin).toBeLessThan(0.55);
    expect(me.controlWards).toBeLessThan(0.5);
    for (const o of others("adc-noward")) {
      expect(me.visionPerMin).toBeLessThan(o.visionPerMin);
      expect(me.dmgShare).toBeGreaterThan(o.dmgShare);
    }
  });

  it("視界サポートは視界がいちばん高く、ダメージ割合がいちばん低い", () => {
    const me = of("sup-vision");
    expect(mainRole(load("sup-vision").matches).role).toBe("UTILITY");
    expect(me.visionPerMin).toBeGreaterThan(2.2);
    expect(me.dmgShare).toBeLessThan(0.13);
    for (const o of others("sup-vision")) {
      expect(me.visionPerMin).toBeGreaterThan(o.visionPerMin);
      expect(me.dmgShare).toBeLessThan(o.dmgShare);
      expect(me.controlWards).toBeGreaterThan(o.controlWards);
    }
  });

  it("万能ジャングルは勝率とKDAがいちばん高い", () => {
    const me = of("jg-solid");
    expect(mainRole(load("jg-solid").matches).role).toBe("JUNGLE");
    expect(me.winRate).toBeGreaterThanOrEqual(0.6);
    expect(me.kp).toBeGreaterThan(0.6);
    for (const o of others("jg-solid")) {
      expect(me.winRate).toBeGreaterThan(o.winRate);
      expect(me.kda).toBeGreaterThan(o.kda);
    }
  });

  it("15分で大きく離された試合は、負けのほうが多い", () => {
    const behind = SAMPLE_PLAYERS.flatMap((s) => withTimeline(load(s.id).matches)).filter(
      (m) => m.timeline.goldDiff15 !== null && m.timeline.goldDiff15 <= -1000,
    );
    expect(behind.length).toBeGreaterThanOrEqual(5);
    expect(behind.filter((m) => m.win).length).toBeLessThan(behind.length / 2);
  });

  it("突撃ミッドは「?」ピンと序盤のデスがいちばん多く、対面にゴールドで負けている", () => {
    const me = detailOf("mid-feeder");
    const ms = load("mid-feeder").matches;
    for (const m of ms) {
      expect(m.missingPings).toBeGreaterThanOrEqual(8);
      expect(m.missingPings).toBeLessThanOrEqual(20);
    }
    for (const o of otherDetails("mid-feeder")) {
      expect(me.missingPings).toBeGreaterThan(o.missingPings);
      expect(me.earlyDeathShare).toBeGreaterThan(o.earlyDeathShare);
      expect(me.soloDeathShare).toBeGreaterThan(o.soloDeathShare);
      expect(me.deepDeathShare).toBeGreaterThan(o.deepDeathShare);
      expect(me.surrenderRate).toBeGreaterThan(o.surrenderRate);
      expect(me.longestLiving).toBeLessThan(o.longestLiving);
      expect(me.laneWinRate).toBeLessThan(o.laneWinRate);
      expect(me.goldDiff15).toBeLessThan(o.goldDiff15);
    }
    expect(me.earlyDeathShare).toBeGreaterThan(0.25);
    expect(me.soloDeathShare).toBeGreaterThan(0.4);
    expect(me.deepDeathShare).toBeGreaterThan(0.4);
    // 10分までに何度も死ぬ試合がある
    const early = withTimeline(ms).map((m) => m.timeline.deathMinutes.filter((t) => t < 10).length);
    expect(early.filter((n) => n >= 3).length).toBeGreaterThanOrEqual(5);
    const gold = present(ms.map((m) => m.goldDiff));
    expect(gold.filter((d) => d < 0).length).toBeGreaterThanOrEqual(gold.length * 0.7);
    const goldOf = (win: boolean) => average(present(ms.filter((m) => m.win === win).map((m) => m.goldDiff)));
    expect(goldOf(false)).toBeLessThan(goldOf(true));
  });

  it("ほかの4人は「?」ピンが少なく、降参もまれ", () => {
    for (const { id } of otherDetails("mid-feeder")) {
      for (const m of load(id).matches) expect(m.missingPings, m.matchId).toBeLessThanOrEqual(6);
      expect(detailOf(id).surrenderRate).toBeLessThanOrEqual(0.25);
    }
  });

  it("農家トップは対面とのCS差とプレートがいちばん多く、ゴールドでも勝っている", () => {
    const me = detailOf("top-farmer");
    const ms = load("top-farmer").matches;
    for (const o of otherDetails("top-farmer")) {
      expect(me.csDiff).toBeGreaterThan(o.csDiff);
      expect(me.csDiff10).toBeGreaterThan(o.csDiff10);
      expect(me.turretPlates).toBeGreaterThan(o.turretPlates);
      expect(me.laneWinRate).toBeGreaterThan(o.laneWinRate);
      expect(me.objectiveShare).toBeLessThan(o.objectiveShare);
    }
    for (const d of present(ms.map((m) => m.csDiff))) {
      expect(d).toBeGreaterThanOrEqual(20);
      expect(d).toBeLessThanOrEqual(70);
    }
    for (const d of present(ms.map((m) => m.goldDiff))) expect(d).toBeGreaterThan(0);
    // 火力は対面より少し下
    expect(average(present(ms.map((m) => m.damageDiff)))).toBeLessThan(0);
    for (const d of present(withTimeline(ms).map((m) => m.timeline.csDiff10))) {
      expect(d).toBeGreaterThanOrEqual(5);
      expect(d).toBeLessThanOrEqual(25);
    }
    expect(me.earlyDeathShare).toBeLessThan(0.15);
  });

  it("ワードを置かないADCは対面との差がプラスにもマイナスにもなる", () => {
    const ms = load("adc-noward").matches;
    for (const key of ["csDiff", "goldDiff", "damageDiff"] as const) {
      const diffs = present(ms.map((m) => m[key]));
      expect(diffs.filter((d) => d > 0).length, key).toBeGreaterThanOrEqual(4);
      expect(diffs.filter((d) => d < 0).length, key).toBeGreaterThanOrEqual(4);
    }
    const me = detailOf("adc-noward");
    for (const o of otherDetails("adc-noward").filter((s) => s.id !== "mid-feeder")) {
      expect(me.deepDeathShare).toBeGreaterThan(o.deepDeathShare);
    }
  });

  it("視界サポートは回復とシールドがいちばん多い", () => {
    const me = detailOf("sup-vision");
    for (const o of otherDetails("sup-vision")) expect(me.healShield).toBeGreaterThan(o.healShield * 3);
    expect(me.healShield).toBeGreaterThan(4000);
    expect(me.earlyDeathShare).toBeLessThan(0.15);
    expect(me.turretPlates).toBeLessThan(1);
  });

  it("万能ジャングルはオブジェクトへのダメージと関与がいちばん多く、奪うこともある", () => {
    const me = detailOf("jg-solid");
    expect(me.epicSteals).toBeGreaterThanOrEqual(1);
    expect(me.epicSteals).toBeLessThanOrEqual(2);
    for (const o of otherDetails("jg-solid")) {
      expect(o.epicSteals).toBe(0);
      expect(me.objectiveDamage).toBeGreaterThan(o.objectiveDamage);
      expect(me.objectiveShare).toBeGreaterThan(o.objectiveShare);
    }
    const gold = present(load("jg-solid").matches.map((m) => m.goldDiff));
    expect(gold.filter((d) => d > 0).length).toBeGreaterThanOrEqual(gold.length * 0.7);
    expect(me.laneWinRate).toBeGreaterThan(0.55);
  });
});
