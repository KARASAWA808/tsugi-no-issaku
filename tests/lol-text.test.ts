import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { CLAIM_COUNT, buildIntro } from "../lol/src/intro";
import { CRITIC_CALL, hashString, makeRng, rankLabel } from "../lol/src/labels";
import { buildReview } from "../lol/src/review";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";
import type { MatchStat, PlayerData } from "../lol/src/types";

function match(over: Partial<MatchStat> = {}): MatchStat {
  return {
    matchId: "T_1", queueId: 420, gameStart: 1_700_000_000_000, durationSec: 1800, win: true, role: "MIDDLE", champion: "Ahri",
    kills: 6, deaths: 5, assists: 7, cs: 190, gold: 11500, damage: 22000, damageTaken: 18000,
    visionScore: 27, wardsPlaced: 10, wardsKilled: 3, controlWards: 2, teamKills: 25, teamDamage: 90000,
    firstBlood: false, soloKills: 1, csAt10: 64, objectives: 2, turretTakedowns: 2, largestMultiKill: 2, timeDeadSec: 180,
    ...over,
  };
}

function build(player: PlayerData, variant = 0, champName?: (id: string) => string) {
  const analysis = analyze(player)!;
  const intro = buildIntro(player, analysis, { variant, champName });
  const review = buildReview(player, analysis, intro, { variant, champName });
  return { analysis, intro, review };
}

const allText = ({ intro, review }: ReturnType<typeof build>): string[] => [
  intro.greeting, ...intro.claims.map((c) => c.text), intro.closing,
  review.opening, ...review.replies.map((r) => r.text), ...review.roasts.map((r) => r.text),
  review.title, review.verdict, review.homework,
];

const samples = SAMPLE_PLAYERS.map((s) => samplePlayer(s.id)!);

describe("labels", () => {
  it("ランクを日本語にする。マスター以上は数字を付けない", () => {
    expect(rankLabel({ tier: "GOLD", division: "IV", lp: 0, wins: 1, losses: 1 })).toBe("ゴールド4");
    expect(rankLabel({ tier: "MASTER", division: "I", lp: 120, wins: 1, losses: 1 })).toBe("マスター");
    expect(rankLabel(null)).toBe("ランク未判定");
  });
  it("同じ種なら同じ乱数の列になる", () => {
    const a = makeRng(hashString("x"));
    const b = makeRng(hashString("x"));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("buildIntro", () => {
  it("どのサンプルでも、言うことはちょうど3つ", () => {
    for (const p of samples) expect(build(p).intro.claims).toHaveLength(CLAIM_COUNT);
  });

  it("あいさつで評価役に呼びかけ、自分の名前を名乗る", () => {
    for (const p of samples) {
      const { greeting } = build(p).intro;
      expect(greeting).toContain(CRITIC_CALL);
      expect(greeting).toContain(p.gameName);
    }
  });

  it("裏づけのある強みを先に言い、足りないぶんは弱みの言い換えで埋める", () => {
    const { analysis, intro } = build(samplePlayer("mid-feeder")!);
    const strengths = new Set<string>(analysis.strengths.map((t) => t.id));
    const backed = intro.claims.filter((c) => c.backed);
    expect(backed.length).toBe(Math.min(CLAIM_COUNT, analysis.strengths.length));
    expect(backed.every((c) => strengths.has(c.topic))).toBe(true);
    expect(intro.claims.map((c) => c.backed)).toEqual([...intro.claims.map((c) => c.backed)].sort((a, b) => Number(b) - Number(a)));
    expect(intro.claims.some((c) => c.topic === "feeder" && !c.backed)).toBe(true);
  });

  it("強みも弱みも出ない人は、気合いで埋める", () => {
    const p: PlayerData = { gameName: "ふつう", tagLine: "TEST", level: 30, rank: null, matches: [match(), match({ win: false })] };
    const { analysis, intro } = build(p);
    const need = CLAIM_COUNT - analysis.strengths.length - analysis.weaknesses.length;
    expect(need).toBeGreaterThan(0);
    expect(intro.claims).toHaveLength(CLAIM_COUNT);
    expect(intro.claims.filter((c) => c.topic === "spirit")).toHaveLength(need);
    // 同じ気合いを2回言わない
    expect(new Set(intro.claims.map((c) => c.text)).size).toBe(CLAIM_COUNT);
  });

  it("同じ人・同じ variant なら同じ文章になる", () => {
    for (const p of samples) expect(build(p, 2)).toEqual(build(p, 2));
  });

  it("variant を変えると、どこかの文が変わる", () => {
    const p = samplePlayer("mid-feeder")!;
    const first = allText(build(p, 0)).join("\n");
    expect([1, 2, 3, 4, 5].some((v) => allText(build(p, v)).join("\n") !== first)).toBe(true);
  });
});

describe("buildReview", () => {
  it("自己紹介のひとつひとつに、同じ順番で返事をする", () => {
    for (const p of samples) {
      const { intro, review } = build(p);
      expect(review.replies.map((r) => r.topic)).toEqual(intro.claims.map((c) => c.topic));
      // 裏づけのある話は認め、言い換えは崩す
      expect(review.replies.map((r) => r.accepted)).toEqual(intro.claims.map((c) => c.backed));
    }
  });

  it("返事で崩した弱みを、あとでもう一度言わない", () => {
    for (const p of samples) {
      for (let variant = 0; variant < 5; variant++) {
        const { intro, review } = build(p, variant);
        const debunked = new Set<string>(intro.claims.filter((c) => !c.backed).map((c) => c.topic));
        expect(review.roasts.some((r) => debunked.has(r.topic))).toBe(false);
      }
    }
  });

  it("強みを認めたうえで、関係する弱みを「ただし」で足す", () => {
    const { intro, review } = build(samplePlayer("top-farmer")!);
    const i = intro.claims.findIndex((c) => c.topic === "cs");
    expect(review.replies[i].accepted).toBe(true);
    expect(review.replies[i].text).toContain("関与率");
    // 「ただし」で触れた弱みは、追加の指摘に出さない
    expect(review.roasts.map((r) => r.topic)).not.toContain("afk");
  });

  it("弱みのない人にも、いちばん低い軸をひとつだけ指摘する", () => {
    const { analysis, review } = build(samplePlayer("jg-solid")!);
    const lowest = analysis.axes.reduce((low, a) => (a.score < low.score ? a : low));
    expect(review.roasts).toHaveLength(1);
    expect(review.roasts[0].topic).toBe(lowest.key);
    expect(review.title).toBe("言うだけのことはある人");
  });

  it("追加の指摘は3つまで", () => {
    for (const p of samples) expect(build(p).review.roasts.length).toBeLessThanOrEqual(3);
  });

  it("評価と称号はいちばん目立つ弱みで決まる", () => {
    const { analysis, review } = build(samplePlayer("mid-feeder")!);
    expect(review.grade).toBe(analysis.grade);
    expect(review.title).toBe("歩く300ゴールド");
    expect(review.verdict).toContain(`${analysis.overall}点`);
  });

  it("試合が少ないときは、話半分だと断る", () => {
    const p: PlayerData = { gameName: "すくない", tagLine: "TEST", level: 30, rank: null, matches: [match(), match()] };
    expect(build(p).review.opening).toContain("話半分");
    expect(build(samples[0]).review.opening).not.toContain("話半分");
  });
});

describe("文章の中身", () => {
  it("どの組み合わせでも、数字の差し込みに失敗した跡が残らない", () => {
    const extremes: PlayerData[] = [
      // ひどい試合ばかり(弱みが全部出る側)
      { gameName: "きびしい", tagLine: "TEST", level: 30, rank: null, matches: Array.from({ length: 12 }, (_, i) =>
        match({ win: i % 6 === 0, champion: `Champ${i}`, role: i % 3 === 0 ? "TOP" : i % 3 === 1 ? "MIDDLE" : "BOTTOM", kills: 1, deaths: 11, assists: 1, cs: 90, csAt10: 30, damage: 6000, visionScore: 6, controlWards: 0, objectives: 0, turretTakedowns: 0, timeDeadSec: 420, teamKills: 20 })) },
      // 出来すぎの試合ばかり(強みが全部出る側)
      { gameName: "できすぎ", tagLine: "TEST", level: 300, rank: { tier: "CHALLENGER", division: "I", lp: 900, wins: 200, losses: 100 }, matches: Array.from({ length: 12 }, () =>
        match({ kills: 14, deaths: 1, assists: 9, cs: 280, csAt10: 95, damage: 34000, visionScore: 55, controlWards: 5, objectives: 5, turretTakedowns: 5, soloKills: 3, firstBlood: true, largestMultiKill: 5, timeDeadSec: 20, teamKills: 28 })) },
      // 10分CSが取れていない
      { gameName: "ふるい", tagLine: "TEST", level: 30, rank: null, matches: Array.from({ length: 9 }, () => match({ csAt10: null, cs: 100 })) },
    ];
    for (const p of [...samples, ...extremes]) {
      for (let variant = 0; variant < 12; variant++) {
        for (const text of allText(build(p, variant))) {
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toMatch(/undefined|NaN|null|Infinity|\[object/);
        }
      }
    }
  });

  it("チャンピオン名は渡した関数で表示名にする", () => {
    const p: PlayerData = { gameName: "ワントリック", tagLine: "TEST", level: 30, rank: null, matches: Array.from({ length: 10 }, () => match({ champion: "LeeSin" })) };
    const text = allText(build(p, 0, (id) => (id === "LeeSin" ? "リー・シン" : id))).join("\n");
    expect(text).toContain("リー・シン");
    expect(text).not.toContain("LeeSin");
  });
});
