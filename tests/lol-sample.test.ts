import { describe, expect, it } from "vitest";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";
import type { MatchStat, PlayerData, Role } from "../lol/src/types";

const ROLES: Role[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM"];

const load = (id: string): PlayerData => {
  const p = samplePlayer(id);
  if (!p) throw new Error(`サンプル ${id} がありません`);
  return p;
};
const sum = (ms: MatchStat[], pick: (m: MatchStat) => number) => ms.reduce((n, m) => n + pick(m), 0);
const minutesOf = (ms: MatchStat[]) => sum(ms, (m) => m.durationSec) / 60;
const mainRole = (ms: MatchStat[]) =>
  ROLES.map((role) => ({ role, n: ms.filter((m) => m.role === role).length })).sort((a, b) => b.n - a.n)[0];

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
});

describe("サンプルごとの傾向", () => {
  const all = SAMPLE_PLAYERS.map((s) => ({ id: s.id, ...summary(s.id) }));
  const others = (id: string) => all.filter((s) => s.id !== id);
  const of = (id: string) => {
    const s = all.find((x) => x.id === id);
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
});
