import { describe, expect, it } from "vitest";
import { analyze, gradeOf, scale } from "../lol/src/analyze";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";
import { match, player } from "./lol-helpers";



// 時間帯の解析が動かす環境の時差で変わらないよう、日本時間で固定する
const sample = (id: string) => analyze(samplePlayer(id)!, { utcOffsetMinutes: 540 })!;
const ids = (traits: readonly { id: string }[]) => traits.map((t) => t.id);

describe("scale", () => {
  it("悪い側で0、良い側で100、あいだは直線", () => {
    expect(scale(4, [4, 8])).toBe(0);
    expect(scale(8, [4, 8])).toBe(100);
    expect(scale(6, [4, 8])).toBe(50);
  });
  it("範囲の外は0と100で止まる", () => {
    expect(scale(1, [4, 8])).toBe(0);
    expect(scale(20, [4, 8])).toBe(100);
  });
  it("小さいほど良い項目(悪い > 良い)でも使える", () => {
    expect(scale(8, [8, 3.5])).toBe(0);
    expect(scale(3.5, [8, 3.5])).toBe(100);
  });
});

describe("gradeOf", () => {
  it("点数の境目で S〜D に分ける", () => {
    expect([80, 79, 67, 66, 54, 53, 41, 40].map(gradeOf)).toEqual(["S", "A", "A", "B", "B", "C", "C", "D"]);
  });
});

describe("analyze", () => {
  it("試合がなければ null", () => {
    expect(analyze(player([]))).toBeNull();
  });

  it("勝率と平均を出す", () => {
    const a = analyze(player([match(), match({ win: false, kills: 2, deaths: 7, assists: 3 })]))!;
    expect(a.games).toBe(2);
    expect(a.wins).toBe(1);
    expect(a.winRate).toBe(0.5);
    expect(a.avg.kills).toBe(4);
    expect(a.avg.deaths).toBe(6);
    expect(a.avg.kda).toBeCloseTo(18 / 12);
    expect(a.avg.csPerMin).toBeCloseTo(380 / 60);
    expect(a.avg.deathsPer30).toBeCloseTo(6);
  });

  it("いちばん多いロールをメインにし、ロールで基準が変わる項目はその試合だけで見る", () => {
    const a = analyze(player([match(), match(), match({ role: "UTILITY", cs: 30, visionScore: 80 })]))!;
    expect(a.mainRole).toBe("MIDDLE");
    expect(a.roleShare).toBeCloseTo(2 / 3);
    // サポートの1試合はCSと視界の平均に入らない
    expect(a.avg.csPerMin).toBeCloseTo(190 / 30);
    expect(a.avg.visionPerMin).toBeCloseTo(27 / 30);
  });

  it("ロールが分からない試合だけでも動く", () => {
    const a = analyze(player([match({ role: "UNKNOWN" })]))!;
    expect(a.mainRole).toBe("UNKNOWN");
    expect(a.roleShare).toBe(1);
  });

  it("10分CSが1試合も取れていなければ null のままにする", () => {
    const a = analyze(player([match({ csAt10: null })]))!;
    expect(a.avg.csAt10).toBeNull();
    expect(a.axes.every((axis) => Number.isFinite(axis.score))).toBe(true);
  });

  it("チャンピオンは試合数の多い順", () => {
    const a = analyze(player([match({ champion: "Zed" }), match(), match()]))!;
    expect(a.champions.map((c) => [c.champion, c.games])).toEqual([["Ahri", 2], ["Zed", 1]]);
  });

  it("いちばんデスの多い試合と最長の連敗を拾う", () => {
    const a = analyze(
      player([match({ win: false }), match({ win: false, deaths: 14, champion: "Yasuo" }), match({ win: false }), match(), match({ win: false })]),
    )!;
    expect(a.worstGame.champion).toBe("Yasuo");
    expect(a.longestLosingStreak).toBe(3);
  });

  it("サポートはCSを弱みにも強みにもしない", () => {
    const a = analyze(player(Array.from({ length: 10 }, () => match({ role: "UTILITY", cs: 25, csAt10: 8, visionScore: 70, controlWards: 5 }))))!;
    expect(ids(a.weaknesses)).not.toContain("lowcs");
    expect(ids(a.weaknesses)).not.toContain("loselane");
    expect(ids(a.strengths)).not.toContain("cs");
  });

  it("KDAは高いのに勝てていない人を見つける", () => {
    const a = analyze(player(Array.from({ length: 10 }, (_, i) => match({ win: i < 3, kills: 4, deaths: 2, assists: 8 }))))!;
    expect(ids(a.strengths)).toContain("kda");
    expect(ids(a.weaknesses)).toContain("kdaplayer");
  });

  it("強みと弱みは、はっきり出ている順に並ぶ", () => {
    for (const s of SAMPLE_PLAYERS) {
      const a = sample(s.id);
      for (const list of [a.strengths, a.weaknesses]) {
        expect(list.map((t) => t.strength)).toEqual([...list.map((t) => t.strength)].sort((x, y) => y - x));
        expect(list.every((t) => t.strength > 0 && t.strength <= 1)).toBe(true);
      }
    }
  });

  it("点数はどれも 0〜100 におさまる", () => {
    for (const s of SAMPLE_PLAYERS) {
      const a = sample(s.id);
      for (const n of [a.overall, ...a.axes.map((axis) => axis.score)]) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("サンプルの5人が、狙ったとおりに診断される", () => {
  it("デスの多い突撃ミッド: デスが弱み、ソロキルが強み、評価は低い", () => {
    const a = sample("mid-feeder");
    expect(a.weaknesses[0].id).toBe("feeder");
    expect(ids(a.strengths)).toContain("solokill");
    expect(a.grade).toBe("D");
  });
  it("ファームだけ上手いトップ: CSが強み、集団戦にいないのが弱み", () => {
    const a = sample("top-farmer");
    expect(a.strengths[0].id).toBe("cs");
    expect(a.weaknesses[0].id).toBe("afk");
  });
  it("ワードを置かないADC: 視界が弱み", () => {
    const a = sample("adc-noward");
    expect(ids(a.weaknesses)).toEqual(expect.arrayContaining(["blind", "nopink"]));
  });
  it("視界のいいサポート: 視界が強みで、CSの話は出ない", () => {
    const a = sample("sup-vision");
    expect(a.mainRole).toBe("UTILITY");
    expect(ids(a.strengths)).toContain("vision");
    expect(ids(a.weaknesses)).not.toContain("lowcs");
  });
  it("そつのないジャングル: 弱みなしで評価はS", () => {
    const a = sample("jg-solid");
    expect(a.weaknesses).toEqual([]);
    expect(a.grade).toBe("S");
    // 対面のいないジャングルに「対面を倒す」とは言わせない
    expect(ids(a.strengths)).not.toContain("solokill");
  });
});
