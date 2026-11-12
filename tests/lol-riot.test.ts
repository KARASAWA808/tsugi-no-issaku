import { describe, expect, it } from "vitest";
import { PLATFORMS, RiotError, fetchPlayer, parseRiotId, slimMatch, slimTimeline } from "../lol/server/riot";

const ME = "puuid-me";
const KEY = "RGAPI-test-key";

type Rec = Record<string, unknown>;

/** 味方4人+敵5人のうちの1人。本人以外は集計に使う項目だけ持たせる */
const other = (index: number, teamId: number, teamPosition: string): Rec => ({
  puuid: `puuid-${teamId}-${index}`,
  teamId,
  teamPosition,
  kills: 2,
  totalDamageDealtToChampions: 10000,
});

/** タイムラインの中での番号。fakeMatch の並び順(本人が先頭、対面のミッドは8番目)と同じ */
const ME_ID = 1;
const OPP_ID = 8;

/** match-v5 の試合。本人(ME)は青チーム(100)のミッド。opp は対面(赤のミッド)に上書きする項目 */
function fakeMatch(opts: { id?: string; start?: number; info?: Rec; me?: Rec; opp?: Rec } = {}): Rec {
  const me: Rec = {
    puuid: ME,
    teamId: 100,
    win: true,
    teamPosition: "MIDDLE",
    championName: "Ahri",
    kills: 7,
    deaths: 3,
    assists: 9,
    totalMinionsKilled: 180,
    neutralMinionsKilled: 12,
    goldEarned: 12345,
    totalDamageDealtToChampions: 25000,
    totalDamageTaken: 18000,
    visionScore: 22,
    wardsPlaced: 9,
    wardsKilled: 3,
    visionWardsBoughtInGame: 2,
    firstBloodKill: false,
    firstBloodAssist: true,
    dragonKills: 1,
    baronKills: 0,
    turretTakedowns: 4,
    largestMultiKill: 2,
    totalTimeSpentDead: 95,
    gameEndedInEarlySurrender: false,
    gameEndedInSurrender: false,
    champLevel: 16,
    damageDealtToObjectives: 8000,
    totalHealsOnTeammates: 300,
    totalDamageShieldedOnTeammates: 450,
    timeCCingOthers: 21,
    longestTimeSpentLiving: 612,
    enemyMissingPings: 4,
    onMyWayPings: 6,
    dangerPings: 1,
    challenges: {
      soloKills: 2,
      laneMinionsFirst10Minutes: 78,
      dragonTakedowns: 2,
      baronTakedowns: 1,
      riftHeraldTakedowns: 1,
      laningPhaseGoldExpAdvantage: 1,
      turretPlatesTaken: 2,
      skillshotsDodged: 31,
      epicMonsterSteals: 1,
    },
    ...opts.me,
  };
  const opp: Rec = {
    ...other(3, 200, "MIDDLE"),
    totalMinionsKilled: 150,
    neutralMinionsKilled: 4,
    goldEarned: 11000,
    ...opts.opp,
  };
  return {
    metadata: { matchId: opts.id ?? "JP1_1" },
    info: {
      mapId: 11,
      queueId: 420,
      gameStartTimestamp: opts.start ?? 1_700_000_000_000,
      gameEndTimestamp: (opts.start ?? 1_700_000_000_000) + 1_800_000,
      gameDuration: 1800,
      participants: [
        me,
        ...["TOP", "JUNGLE", "BOTTOM", "UTILITY"].map((position, i) => other(i + 1, 100, position)),
        other(1, 200, "TOP"),
        other(2, 200, "JUNGLE"),
        opp,
        other(4, 200, "BOTTOM"),
        other(5, 200, "UTILITY"),
      ],
      teams: [
        // horde(ヴォイドグラブ)や tower は teamObjectives に数えない
        { teamId: 100, objectives: { dragon: { kills: 3 }, baron: { kills: 1 }, riftHerald: { kills: 1 }, horde: { kills: 3 }, tower: { kills: 9 } } },
        { teamId: 200, objectives: { dragon: { kills: 1 }, baron: { kills: 0 }, riftHerald: { kills: 0 } } },
      ],
      ...opts.info,
    },
  };
}

/** CHAMPION_KILL の出来事。アシストが無いキルは、本物と同じく assistingParticipantIds ごと省く */
function kill(timestamp: number, killerId: number, victimId: number, extra: { assists?: number[]; x?: number; y?: number } = {}): Rec {
  return {
    type: "CHAMPION_KILL",
    timestamp,
    killerId,
    victimId,
    ...(extra.assists ? { assistingParticipantIds: extra.assists } : {}),
    position: { x: extra.x ?? 7400, y: extra.y ?? 7500 },
  };
}

/**
 * match-v5 のタイムライン。0分〜minutes分のフレームを持ち、endMs を渡すと試合終了の瞬間のフレームを最後に足す。
 * i分時点で、本人は 500+400i ゴールド・ミニオン 7i(10分からは中立+4)、対面は 500+350i ゴールド・ミニオン 6i。
 */
function fakeTimeline(opts: { id?: string; minutes?: number; endMs?: number; events?: unknown[]; info?: Rec } = {}): Rec {
  const minutes = opts.minutes ?? 20;
  const stamps = Array.from({ length: minutes + 1 }, (_, i) => i * 60_000 + i * 17); // 本物も少しずつずれる
  if (opts.endMs !== undefined) stamps.push(opts.endMs);
  const frames = stamps.map((timestamp, i) => ({
    timestamp,
    participantFrames: Object.fromEntries(
      Array.from({ length: 10 }, (_, seat) => {
        const id = seat + 1;
        const frame = id === ME_ID
          ? { totalGold: 500 + 400 * i, minionsKilled: 7 * i, jungleMinionsKilled: i >= 10 ? 4 : 0 }
          : { totalGold: 500 + 350 * i, minionsKilled: 6 * i, jungleMinionsKilled: 0 };
        return [String(id), { participantId: id, xp: 400 * i, level: 1 + Math.floor(i / 2), ...frame }];
      }),
    ),
    events: [] as unknown[],
  }));
  // 出来事は、その時刻を過ぎて最初のフレームに入る
  for (const event of opts.events ?? []) {
    const at = isRec(event) && typeof event.timestamp === "number" ? event.timestamp : 0;
    (frames.find((f) => f.timestamp >= at) ?? frames[frames.length - 1]).events.push(event);
  }
  const puuids = (fakeMatch().info as { participants: Rec[] }).participants.map((p) => p.puuid);
  return {
    metadata: { matchId: opts.id ?? "JP1_1", participants: puuids },
    info: {
      frameInterval: 60_000,
      participants: puuids.map((puuid, i) => ({ participantId: i + 1, puuid })),
      frames,
      ...opts.info,
    },
  };
}

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

describe("Riot ID の読み取り", () => {
  it("名前とタグに分け、前後の空白は落とす", () => {
    expect(parseRiotId("  Hide on bush#KR1 ")).toEqual({ gameName: "Hide on bush", tagLine: "KR1" });
    expect(parseRiotId("なまえ#JP1")).toEqual({ gameName: "なまえ", tagLine: "JP1" });
  });

  it("全角の＃や全角英数のタグも通す", () => {
    expect(parseRiotId("なまえ＃JP1")).toEqual({ gameName: "なまえ", tagLine: "JP1" });
    expect(parseRiotId("なまえ#ＪＰ１")).toEqual({ gameName: "なまえ", tagLine: "JP1" });
  });

  it("タグが無い・長さが合わないものは null", () => {
    expect(parseRiotId("なまえ")).toBeNull();
    expect(parseRiotId("なまえ#")).toBeNull();
    expect(parseRiotId("#JP1")).toBeNull();
    expect(parseRiotId("ab#JP1")).toBeNull(); // 名前は3文字から
    expect(parseRiotId(`${"a".repeat(17)}#JP1`)).toBeNull(); // 16文字まで
    expect(parseRiotId("なまえ#JP")).toBeNull(); // タグは3〜5文字
    expect(parseRiotId("なまえ#JAPAN1")).toBeNull();
    expect(parseRiotId("なまえ#J-1")).toBeNull(); // 記号は不可
    expect(parseRiotId("")).toBeNull();
  });
});

describe("サーバーと地域の対応", () => {
  it("日本と韓国は asia、オセアニアと東南アジアは sea", () => {
    expect(PLATFORMS.jp1).toBe("asia");
    expect(PLATFORMS.kr).toBe("asia");
    expect(PLATFORMS.na1).toBe("americas");
    expect(PLATFORMS.euw1).toBe("europe");
    expect(PLATFORMS.oc1).toBe("sea");
  });
});

describe("試合データの切り出し", () => {
  it("ふつうの試合から本人の成績を抜き出す", () => {
    expect(slimMatch(fakeMatch(), ME)).toEqual({
      matchId: "JP1_1",
      queueId: 420,
      gameStart: 1_700_000_000_000,
      durationSec: 1800,
      win: true,
      role: "MIDDLE",
      champion: "Ahri",
      kills: 7,
      deaths: 3,
      assists: 9,
      cs: 192,
      gold: 12345,
      damage: 25000,
      damageTaken: 18000,
      visionScore: 22,
      wardsPlaced: 9,
      wardsKilled: 3,
      controlWards: 2,
      teamKills: 15,
      teamDamage: 65000,
      firstBlood: true,
      soloKills: 2,
      csAt10: 78,
      objectives: 4,
      turretTakedowns: 4,
      largestMultiKill: 2,
      timeDeadSec: 95,
      side: "blue",
      level: 16,
      csDiff: 192 - 154,
      goldDiff: 1345,
      damageDiff: 15000,
      laneWon: true,
      turretPlates: 2,
      objectiveDamage: 8000,
      teamObjectives: 5,
      healShield: 750,
      ccSec: 21,
      skillshotsDodged: 31,
      epicSteals: 1,
      pings: 11,
      missingPings: 4,
      surrendered: false,
      longestLivingSec: 612,
      timeline: null,
    });
  });

  it("味方の合計に敵チームは入れない", () => {
    const match = fakeMatch({ me: { teamId: 200, kills: 1, totalDamageDealtToChampions: 5000 } });
    // 本人が赤チームに入ると、赤は6人になる(元の5人+本人)
    const stat = slimMatch(match, ME);
    expect(stat?.teamKills).toBe(1 + 2 * 5);
    expect(stat?.teamDamage).toBe(5000 + 10000 * 5);
  });

  it("リメイクは数えない", () => {
    expect(slimMatch(fakeMatch({ me: { gameEndedInEarlySurrender: true } }), ME)).toBeNull();
    expect(slimMatch(fakeMatch({ info: { gameDuration: 240 } }), ME)).toBeNull();
  });

  it("ARAM(サモナーズリフト以外)は数えない", () => {
    expect(slimMatch(fakeMatch({ info: { mapId: 12, queueId: 450 } }), ME)).toBeNull();
  });

  it("本人がいない試合と、形が壊れたデータは null", () => {
    expect(slimMatch(fakeMatch(), "puuid-somebody-else")).toBeNull();
    expect(slimMatch(null, ME)).toBeNull();
    expect(slimMatch({}, ME)).toBeNull();
    expect(slimMatch({ metadata: { matchId: "JP1_1" }, info: { mapId: 11 } }, ME)).toBeNull();
    expect(slimMatch({ status: { status_code: 404 } }, ME)).toBeNull();
  });

  it("challenges が無い試合は csAt10 が null で、オブジェクトはキル数で代用する", () => {
    const stat = slimMatch(fakeMatch({ me: { challenges: undefined } }), ME);
    expect(stat?.csAt10).toBeNull();
    expect(stat?.soloKills).toBe(0);
    expect(stat?.objectives).toBe(1);
  });

  it("ジャングルの10分CSは足して丸める", () => {
    const challenges = { laneMinionsFirst10Minutes: 4, jungleCsBefore10Minutes: 61.00000008 };
    expect(slimMatch(fakeMatch({ me: { challenges } }), ME)?.csAt10).toBe(65);
  });

  it("ロールが空なら UNKNOWN、欠けた数値は 0", () => {
    const stat = slimMatch(fakeMatch({ me: { teamPosition: "", wardsPlaced: undefined, goldEarned: "たくさん" } }), ME);
    expect(stat?.role).toBe("UNKNOWN");
    expect(stat?.wardsPlaced).toBe(0);
    expect(stat?.gold).toBe(0);
  });

  it("古いパッチの試合時間(ミリ秒)は秒に直す", () => {
    const old = fakeMatch({ info: { gameEndTimestamp: undefined, gameDuration: 1_800_000 } });
    expect(slimMatch(old, ME)?.durationSec).toBe(1800);
  });

  it("フィドルスティックスは Data Dragon のIDに合わせる", () => {
    expect(slimMatch(fakeMatch({ me: { championName: "FiddleSticks" } }), ME)?.champion).toBe("Fiddlesticks");
  });
});

describe("くわしい解析用の項目", () => {
  it("対面は相手チームの同じロール。差は 自分 − 対面", () => {
    const opp = { totalMinionsKilled: 200, neutralMinionsKilled: 10, goldEarned: 13000, totalDamageDealtToChampions: 31000 };
    const stat = slimMatch(fakeMatch({ opp }), ME);
    expect(stat?.csDiff).toBe(192 - 210);
    expect(stat?.goldDiff).toBe(12345 - 13000);
    expect(stat?.damageDiff).toBe(25000 - 31000);
  });

  it("対面が決まらない試合は、差が null", () => {
    const nulls = { csDiff: null, goldDiff: null, damageDiff: null };
    // 本人のロールが空
    expect(slimMatch(fakeMatch({ me: { teamPosition: "" } }), ME)).toMatchObject(nulls);
    // 相手チームに同じロールがいない
    expect(slimMatch(fakeMatch({ opp: { teamPosition: "" } }), ME)).toMatchObject(nulls);
    // 同じロールでも味方は対面ではない(赤に移ると、赤のミッドが2人・青のミッドは0人になる)
    expect(slimMatch(fakeMatch({ me: { teamId: 200 } }), ME)).toMatchObject({ ...nulls, side: "red" });
  });

  it("レーン戦の勝ち負けは 1 → true、0 → false、無ければ null", () => {
    const withLane = (value: unknown) => slimMatch(fakeMatch({ me: { challenges: { laningPhaseGoldExpAdvantage: value } } }), ME);
    expect(withLane(1)?.laneWon).toBe(true);
    expect(withLane(0)?.laneWon).toBe(false);
    expect(withLane(undefined)?.laneWon).toBeNull();
    expect(slimMatch(fakeMatch({ me: { challenges: undefined } }), ME)?.laneWon).toBeNull();
  });

  it("ピンは「〜Pings」の項目を全部足す", () => {
    const me = {
      allInPings: 1,
      assistMePings: 2,
      commandPings: 3,
      enemyMissingPings: 9,
      enemyVisionPings: 4,
      getBackPings: 5,
      holdPings: 6,
      needVisionPings: 7,
      onMyWayPings: 8,
      pushPings: 10,
      visionClearedPings: 11,
      basicPings: 12,
      dangerPings: 13,
      retreatPings: 14,
      someFuturePings: 100, // これから増える種類も拾う
      brokenPings: "たくさん", // 数値でないものは 0
      pingsAreFun: 999, // 「Pings」で終わらない項目は足さない
    };
    const stat = slimMatch(fakeMatch({ me }), ME);
    expect(stat?.pings).toBe(205);
    expect(stat?.missingPings).toBe(9);
  });

  it("味方チームのオブジェクトはドラゴン+バロン+ヘラルド。無ければ 0", () => {
    expect(slimMatch(fakeMatch(), ME)?.teamObjectives).toBe(5);
    expect(slimMatch(fakeMatch({ me: { teamId: 200 } }), ME)?.teamObjectives).toBe(1);
    expect(slimMatch(fakeMatch({ info: { teams: undefined } }), ME)?.teamObjectives).toBe(0);
    const partial = [{ teamId: 100, objectives: { dragon: { kills: 2 }, baron: {} } }];
    expect(slimMatch(fakeMatch({ info: { teams: partial } }), ME)?.teamObjectives).toBe(2);
    expect(slimMatch(fakeMatch({ info: { teams: [{ teamId: 100 }] } }), ME)?.teamObjectives).toBe(0);
  });

  it("降参は、負けた試合だけ数える", () => {
    expect(slimMatch(fakeMatch({ me: { gameEndedInSurrender: true, win: false } }), ME)?.surrendered).toBe(true);
    expect(slimMatch(fakeMatch({ me: { gameEndedInSurrender: true, win: true } }), ME)?.surrendered).toBe(false);
    expect(slimMatch(fakeMatch({ me: { gameEndedInSurrender: false, win: false } }), ME)?.surrendered).toBe(false);
  });

  it("challenges が無い試合は、そこから取る数が 0", () => {
    const stat = slimMatch(fakeMatch({ me: { challenges: undefined } }), ME);
    expect(stat).toMatchObject({ turretPlates: 0, skillshotsDodged: 0, epicSteals: 0 });
  });

  it("一度も死ななかった試合の最長生存は、試合の長さ", () => {
    // Riot は死ななかった試合の longestTimeSpentLiving を 0 で返す
    expect(slimMatch(fakeMatch({ me: { deaths: 0, longestTimeSpentLiving: 0 } }), ME)?.longestLivingSec).toBe(1800);
    expect(slimMatch(fakeMatch({ me: { deaths: 2, longestTimeSpentLiving: 0 } }), ME)?.longestLivingSec).toBe(0);
  });
});

describe("タイムラインの切り出し", () => {
  it("10分・15分のゴールド差と、10分のCS差を出す", () => {
    expect(slimTimeline(fakeTimeline(), fakeMatch(), ME)).toEqual({
      goldDiff10: 500,
      goldDiff15: 750,
      csDiff10: 74 - 60,
      takedowns10: 0,
      deathMinutes: [],
      soloDeaths: 0,
      deepDeaths: 0,
    });
  });

  it("そこまで続かなかった試合の差は null", () => {
    const short = slimTimeline(fakeTimeline({ minutes: 12, endMs: 12 * 60_000 + 31_000 }), fakeMatch(), ME);
    expect(short).toMatchObject({ goldDiff10: 500, csDiff10: 14, goldDiff15: null });
    expect(slimTimeline(fakeTimeline({ minutes: 9 }), fakeMatch(), ME)).toMatchObject({ goldDiff10: null, csDiff10: null, goldDiff15: null });
  });

  it("試合終了の瞬間のフレームは、番号が 10 でも 10分時点とはみなさない", () => {
    // 9分40秒で終わった試合。frames[10] はあるが、時刻は 580000
    const ended = slimTimeline(fakeTimeline({ minutes: 9, endMs: 580_000 }), fakeMatch(), ME);
    expect(ended).toMatchObject({ goldDiff10: null, csDiff10: null });
    // 時刻が入っていないフレームは、番号を信じる
    const bare = fakeTimeline({ minutes: 10 });
    for (const frame of (bare.info as { frames: Rec[] }).frames) delete frame.timestamp;
    expect(slimTimeline(bare, fakeMatch(), ME)).toMatchObject({ goldDiff10: 500, csDiff10: 14 });
  });

  it("対面が決まらない試合は、差だけ null で、デスは数える", () => {
    const events = [kill(200_000, OPP_ID, ME_ID)];
    const stat = slimTimeline(fakeTimeline({ events }), fakeMatch({ me: { teamPosition: "" } }), ME);
    expect(stat).toMatchObject({ goldDiff10: null, goldDiff15: null, csDiff10: null, deathMinutes: [3.3], soloDeaths: 1 });
  });

  it("10分までのキルとアシストを数える", () => {
    const events = [
      kill(120_000, ME_ID, OPP_ID), // キル
      kill(300_000, 2, 6, { assists: [3, ME_ID] }), // アシスト
      kill(400_000, 2, 6, { assists: [3] }), // 関わっていない
      kill(450_000, OPP_ID, ME_ID), // 自分のデス
      kill(599_999, ME_ID, 7), // ぎりぎり10分前
      kill(600_000, ME_ID, 7), // 10分ちょうどは入れない
      { type: "CHAMPION_SPECIAL_KILL", timestamp: 120_000, killerId: ME_ID, killType: "KILL_FIRST_BLOOD" },
      { type: "ELITE_MONSTER_KILL", timestamp: 500_000, killerId: ME_ID, monsterType: "DRAGON" },
    ];
    expect(slimTimeline(fakeTimeline({ events }), fakeMatch(), ME)?.takedowns10).toBe(3);
  });

  it("死んだ時刻は分(小数1桁)で、時刻順", () => {
    const events = [
      kill(1_234_567, OPP_ID, ME_ID), // 20.57…分
      kill(183_000, OPP_ID, ME_ID), // 3.05分
      kill(600_000, 7, ME_ID),
      kill(90_000, ME_ID, OPP_ID), // 自分のキルは入れない
    ];
    const stat = slimTimeline(fakeTimeline({ minutes: 25, events }), fakeMatch(), ME);
    expect(stat?.deathMinutes).toEqual([3.1, 10, 20.6]);
  });

  it("1人にやられたデスだけを soloDeaths に数える", () => {
    const events = [
      kill(100_000, OPP_ID, ME_ID), // アシストの配列ごと無い → 1人
      kill(200_000, OPP_ID, ME_ID, { assists: [] }), // 空の配列 → 1人
      kill(300_000, OPP_ID, ME_ID, { assists: [7] }), // 2人がかり
      kill(400_000, 0, ME_ID), // タワーやモンスターに倒された
      kill(500_000, 0, ME_ID, { assists: [OPP_ID] }),
    ];
    const stat = slimTimeline(fakeTimeline({ events }), fakeMatch(), ME);
    expect(stat?.deathMinutes).toHaveLength(5);
    expect(stat?.soloDeaths).toBe(2);
  });

  it("相手側の陣地で死んだデスを deepDeaths に数える(青側)", () => {
    const events = [
      kill(100_000, OPP_ID, ME_ID, { x: 12000, y: 12500 }), // 赤の陣地の奥
      kill(200_000, OPP_ID, ME_ID, { x: 8450, y: 8451 }), // 16901: 帯のすぐ外
      kill(300_000, OPP_ID, ME_ID, { x: 8450, y: 8450 }), // 16900: 帯の中(川のあたり)
      kill(400_000, OPP_ID, ME_ID, { x: 2000, y: 2500 }), // 自陣
      { type: "CHAMPION_KILL", timestamp: 500_000, killerId: OPP_ID, victimId: ME_ID }, // 位置が無い
      { type: "CHAMPION_KILL", timestamp: 600_000, killerId: OPP_ID, victimId: ME_ID, position: { x: 14000 } },
    ];
    const stat = slimTimeline(fakeTimeline({ events }), fakeMatch(), ME);
    expect(stat?.deathMinutes).toHaveLength(6);
    expect(stat?.deepDeaths).toBe(2);
  });

  it("赤側は、青の陣地で死んだデスを数える", () => {
    const events = [
      kill(100_000, 3, ME_ID, { x: 2000, y: 2500 }), // 青の陣地の奥
      kill(200_000, 3, ME_ID, { x: 6450, y: 6449 }), // 12899: 帯のすぐ外
      kill(300_000, 3, ME_ID, { x: 6450, y: 6450 }), // 12900: 帯の中
      kill(400_000, 3, ME_ID, { x: 12000, y: 12500 }), // 自陣
    ];
    const stat = slimTimeline(fakeTimeline({ events }), fakeMatch({ me: { teamId: 200 } }), ME);
    expect(stat?.deepDeaths).toBe(2);
  });

  it("番号はタイムラインの対応表から引き、無ければ match の並び順で代用する", () => {
    const events = [kill(100_000, OPP_ID, 4), kill(200_000, OPP_ID, ME_ID), kill(300_000, OPP_ID, ME_ID)];
    // 対応表で本人が4番になっている
    const moved = fakeTimeline({ events, info: { participants: [{ participantId: 4, puuid: ME }] } });
    expect(slimTimeline(moved, fakeMatch(), ME)?.deathMinutes).toEqual([1.7]);
    // 対応表が無い → 並び順(本人は先頭 = 1番、対面は8番)
    const bare = slimTimeline(fakeTimeline({ events, info: { participants: undefined } }), fakeMatch(), ME);
    expect(bare).toMatchObject({ deathMinutes: [3.3, 5], goldDiff10: 500 });
  });

  it("形が壊れたデータは null", () => {
    expect(slimTimeline(null, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline({}, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline({ info: {} }, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline({ info: { frames: "なし" } }, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline({ info: { frames: [] } }, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline({ status: { status_code: 404 } }, fakeMatch(), ME)).toBeNull();
    expect(slimTimeline(fakeTimeline(), null, ME)).toBeNull();
    expect(slimTimeline(fakeTimeline(), { info: {} }, ME)).toBeNull();
    // 別の試合のタイムライン
    expect(slimTimeline(fakeTimeline({ id: "JP1_9" }), fakeMatch({ id: "JP1_1" }), ME)).toBeNull();
  });

  it("フレームや出来事の一部が壊れていても、読めるところだけ使う", () => {
    const timeline = fakeTimeline({ events: [kill(100_000, OPP_ID, ME_ID), null, "こわれた", { type: "CHAMPION_KILL", victimId: ME_ID }] });
    const frames = (timeline.info as { frames: unknown[] }).frames;
    (frames[10] as Rec).participantFrames = { [String(ME_ID)]: { totalGold: 4500 } }; // 対面のぶんが無い
    (frames[5] as Rec).events = "なし";
    const stat = slimTimeline(timeline, fakeMatch(), ME);
    expect(stat).toMatchObject({ goldDiff10: null, csDiff10: null, goldDiff15: 750, deathMinutes: [1.7] });
  });

  it("本人がいなければ null", () => {
    expect(slimTimeline(fakeTimeline(), fakeMatch(), "puuid-somebody-else")).toBeNull();
  });
});

// ---- fetchPlayer: 本物の Riot API は呼ばず、URL ごとに決めた応答を返す fetch で確かめる ----

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Route = Reply | ((url: URL, hit: number) => Reply);

const ACCOUNT = "/riot/account/v1/accounts/by-riot-id/";
const SUMMONER = "/lol/summoner/v4/summoners/by-puuid/";
const LEAGUE = "/lol/league/v4/entries/by-puuid/";
const IDS = `/lol/match/v5/matches/by-puuid/${ME}/ids`;
const MATCH = "/lol/match/v5/matches/";
const TIMELINE = "/timeline";
/** 「/lol/match/v5/matches/JP1_2/timeline」のように、1試合のタイムラインだけを指すパス */
const timelineOf = (id: string) => `${MATCH}${id}${TIMELINE}`;

/** いちばん長く一致したパスの応答を返す。呼ばれた URL とキーも覚えておく */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: URL; key: string | null }[] = [];
  const hits = new Map<string, number>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, key: new Headers(init?.headers).get("X-Riot-Token") });
    const path = Object.keys(routes)
      .filter((p) => url.pathname.startsWith(p))
      .sort((a, b) => b.length - a.length)[0];
    if (!path) return new Response("{}", { status: 404 });
    const hit = (hits.get(path) ?? 0) + 1;
    hits.set(path, hit);
    const route = routes[path];
    const reply = typeof route === "function" ? route(url, hit) : route;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

/** 3試合ぶんの、うまくいく応答ひとそろい。上書きしたい分だけ extra で渡す */
function happyRoutes(extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    [ACCOUNT]: { body: { puuid: ME, gameName: "Namae", tagLine: "JP1" } },
    [SUMMONER]: { body: { puuid: ME, summonerLevel: 321 } },
    [LEAGUE]: {
      body: [
        { queueType: "RANKED_FLEX_SR", tier: "SILVER", rank: "I", leaguePoints: 10, wins: 1, losses: 2 },
        { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: 45, wins: 30, losses: 28 },
      ],
    },
    [IDS]: { body: ["JP1_3", "JP1_2", "JP1_1"] },
    [MATCH]: matchRoute(),
    ...extra,
  };
}

/** 試合の詳細と、その試合のタイムライン(/timeline)の両方に答える。timeline を渡すと、タイムラインの応答だけ差しかえる */
function matchRoute(timeline?: Reply): Route {
  return (url) => {
    const isTimeline = url.pathname.endsWith(TIMELINE);
    const id = url.pathname.slice(MATCH.length, isTimeline ? -TIMELINE.length : undefined);
    if (isTimeline) return timeline ?? { body: fakeTimeline({ id }) };
    return { body: fakeMatch({ id, start: 1_700_000_000_000 + Number(id.slice(4)) * 3_600_000 }) };
  };
}

const isTimelineCall = (call: { url: URL }) => call.url.pathname.endsWith(TIMELINE);

const ask = (fetchImpl: typeof fetch, count = 20) =>
  fetchPlayer({ apiKey: KEY, gameName: "namae", tagLine: "jp1", platform: "jp1", count, fetchImpl });

/** 失敗するはずの呼び出しから RiotError を取り出す */
async function errorOf(job: Promise<unknown>): Promise<RiotError> {
  const error = await job.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RiotError);
  return error as RiotError;
}

describe("プレイヤーの取得", () => {
  it("レベル・ランク・試合を新しい順にまとめる", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes());
    const player = await ask(fetchImpl);

    // 表記は Riot に登録されているものに合わせる
    expect(player.gameName).toBe("Namae");
    expect(player.tagLine).toBe("JP1");
    expect(player.level).toBe(321);
    expect(player.rank).toEqual({ tier: "GOLD", division: "II", lp: 45, wins: 30, losses: 28 });
    expect(player.matches.map((m) => m.matchId)).toEqual(["JP1_3", "JP1_2", "JP1_1"]);
    expect(player.sample).toBeUndefined();

    // アカウント・レベル・ランク・試合ID + 詳細3 + タイムライン3。キーは全部の呼び出しにヘッダーで付け、URL には出さない
    expect(calls).toHaveLength(10);
    expect(calls.every((c) => c.key === KEY)).toBe(true);
    expect(calls.some((c) => c.url.href.includes(KEY))).toBe(false);

    // アカウントと試合は地域ホスト、レベルとランクはプラットフォームのホスト
    const hostOf = (path: string) => calls.find((c) => c.url.pathname.startsWith(path))?.url.host;
    expect(hostOf(ACCOUNT)).toBe("asia.api.riotgames.com");
    expect(hostOf(MATCH)).toBe("asia.api.riotgames.com");
    expect(hostOf(SUMMONER)).toBe("jp1.api.riotgames.com");
    expect(hostOf(LEAGUE)).toBe("jp1.api.riotgames.com");
  });

  it("名前とタグは URL エンコードし、試合数は 1〜30 に収める", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes());
    await fetchPlayer({ apiKey: KEY, gameName: "な まえ/?", tagLine: "JP1", platform: "JP1", count: 99, fetchImpl });
    expect(calls[0].url.pathname).toBe(`${ACCOUNT}${encodeURIComponent("な まえ/?")}/JP1`);
    const ids = calls.find((c) => c.url.pathname === IDS)?.url;
    expect(ids?.searchParams.get("start")).toBe("0");
    expect(ids?.searchParams.get("count")).toBe("30");
  });

  it("東南アジアのサーバーは、試合を sea・アカウントを asia に聞く", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes());
    await fetchPlayer({ apiKey: KEY, gameName: "namae", tagLine: "SG2", platform: "sg2", count: 3, fetchImpl });
    const hostOf = (path: string) => calls.find((c) => c.url.pathname.startsWith(path))?.url.host;
    expect(hostOf(ACCOUNT)).toBe("asia.api.riotgames.com");
    expect(hostOf(IDS)).toBe("sea.api.riotgames.com");
    expect(hostOf(SUMMONER)).toBe("sg2.api.riotgames.com");
  });

  it("対応していないサーバーは、何も呼ばずに bad-request", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes());
    const error = await errorOf(
      fetchPlayer({ apiKey: KEY, gameName: "namae", tagLine: "JP1", platform: "mars1", count: 20, fetchImpl }),
    );
    expect(error.code).toBe("bad-request");
    expect(calls).toHaveLength(0);
  });

  it("アカウントが 404 なら not-found", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes({ [ACCOUNT]: { status: 404 } }));
    expect((await errorOf(ask(fetchImpl))).code).toBe("not-found");
    expect(calls).toHaveLength(1);
  });

  it("403 なら bad-key で、メッセージにキーは入れない", async () => {
    const { fetchImpl } = fakeFetch(happyRoutes({ [ACCOUNT]: { status: 403 } }));
    const error = await errorOf(ask(fetchImpl));
    expect(error.code).toBe("bad-key");
    expect(error.message).not.toContain(KEY);
  });

  it("途中でキーが切れたら、試合を飛ばさずに bad-key で止める", async () => {
    const { fetchImpl } = fakeFetch(happyRoutes({ [MATCH]: { status: 401 } }));
    expect((await errorOf(ask(fetchImpl))).code).toBe("bad-key");
  });

  it("429 は Retry-After を待ってやり直す", async () => {
    const { fetchImpl, calls } = fakeFetch(
      happyRoutes({
        [ACCOUNT]: (_url, hit) =>
          hit === 1
            ? { status: 429, headers: { "Retry-After": "0" } }
            : { body: { puuid: ME, gameName: "Namae", tagLine: "JP1" } },
      }),
    );
    const player = await ask(fetchImpl);
    expect(player.matches).toHaveLength(3);
    expect(calls.filter((c) => c.url.pathname.startsWith(ACCOUNT))).toHaveLength(2);
  });

  it("429 が続いたら、3回目で rate-limit", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes({ [ACCOUNT]: { status: 429, headers: { "Retry-After": "0" } } }));
    expect((await errorOf(ask(fetchImpl))).code).toBe("rate-limit");
    expect(calls).toHaveLength(3);
  });

  it("待ち時間が長すぎる 429 は、待たずに rate-limit", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes({ [ACCOUNT]: { status: 429, headers: { "Retry-After": "90" } } }));
    const error = await errorOf(ask(fetchImpl));
    expect(error.code).toBe("rate-limit");
    expect(error.retryAfterSec).toBe(90);
    expect(calls).toHaveLength(1);
  });

  it("試合の詳細が1つ失敗しても、その試合だけ飛ばす", async () => {
    const routes = happyRoutes();
    const { fetchImpl } = fakeFetch({ ...routes, [`${MATCH}JP1_2`]: { status: 500 } });
    const player = await ask(fetchImpl);
    expect(player.matches.map((m) => m.matchId)).toEqual(["JP1_3", "JP1_1"]);
  });

  it("試合ごとにタイムラインを取って付ける", async () => {
    const { fetchImpl, calls } = fakeFetch(happyRoutes());
    const player = await ask(fetchImpl);
    expect(player.matches).toHaveLength(3);
    for (const match of player.matches) {
      expect(match.timeline).toEqual({
        goldDiff10: 500,
        goldDiff15: 750,
        csDiff10: 14,
        takedowns10: 0,
        deathMinutes: [],
        soloDeaths: 0,
        deepDeaths: 0,
      });
    }
    const timelines = calls.filter(isTimelineCall);
    expect(timelines.map((c) => c.url.pathname).sort()).toEqual(["JP1_1", "JP1_2", "JP1_3"].map(timelineOf));
    expect(timelines.every((c) => c.url.host === "asia.api.riotgames.com" && c.key === KEY)).toBe(true);
  });

  it("タイムラインが1つ失敗しても、その試合は timeline が null で残す", async () => {
    for (const reply of [{ status: 500 }, { status: 404 }, { body: { info: {} } }, { body: "こわれた" }]) {
      const { fetchImpl } = fakeFetch(happyRoutes({ [timelineOf("JP1_2")]: reply }));
      const player = await ask(fetchImpl);
      expect(player.matches.map((m) => m.matchId)).toEqual(["JP1_3", "JP1_2", "JP1_1"]);
      expect(player.matches.map((m) => m.timeline !== null)).toEqual([true, false, true]);
    }
  });

  it("タイムラインが全部失敗しても、試合は返す", async () => {
    const { fetchImpl } = fakeFetch(happyRoutes({ [MATCH]: matchRoute({ status: 503 }) }));
    const player = await ask(fetchImpl);
    expect(player.matches).toHaveLength(3);
    expect(player.matches.every((m) => m.timeline === null)).toBe(true);
  });

  it("集計しない試合と、詳細が失敗した試合のタイムラインは取りにいかない", async () => {
    const base = matchRoute();
    const { fetchImpl, calls } = fakeFetch(
      happyRoutes({
        [`${MATCH}JP1_2`]: { status: 500 },
        [`${MATCH}JP1_3`]: (url) => (url.pathname.endsWith(TIMELINE) ? { status: 500 } : { body: fakeMatch({ id: "JP1_3", info: { mapId: 12 } }) }),
        [MATCH]: base,
      }),
    );
    const player = await ask(fetchImpl);
    expect(player.matches.map((m) => m.matchId)).toEqual(["JP1_1"]);
    expect(calls.filter(isTimelineCall).map((c) => c.url.pathname)).toEqual([timelineOf("JP1_1")]);
  });

  it("タイムラインで 403 なら bad-key", async () => {
    const one = fakeFetch(happyRoutes({ [timelineOf("JP1_2")]: { status: 403 } }));
    expect((await errorOf(ask(one.fetchImpl))).code).toBe("bad-key");
    const all = fakeFetch(happyRoutes({ [MATCH]: matchRoute({ status: 401 }) }));
    expect((await errorOf(ask(all.fetchImpl))).code).toBe("bad-key");
  });

  it("タイムラインで回数制限にかかったら、残りは取りにいかず、試合は返す", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `JP1_${8 - i}`);
    const { fetchImpl, calls } = fakeFetch(
      happyRoutes({
        [IDS]: { body: ids },
        [MATCH]: matchRoute({ status: 429, headers: { "Retry-After": "90" } }),
      }),
    );
    const player = await ask(fetchImpl);
    expect(player.matches.map((m) => m.matchId)).toEqual(ids);
    expect(player.matches.every((m) => m.timeline === null)).toBe(true);
    // 同時に取りにいく5つだけ。新しい試合から順に取る
    expect(calls.filter(isTimelineCall).map((c) => c.url.pathname)).toEqual(ids.slice(0, 5).map(timelineOf));
  });

  it("タイムラインの 429 も Retry-After を待ってやり直す", async () => {
    const { fetchImpl, calls } = fakeFetch(
      happyRoutes({
        [timelineOf("JP1_2")]: (_url, hit) =>
          hit === 1 ? { status: 429, headers: { "Retry-After": "0" } } : { body: fakeTimeline({ id: "JP1_2" }) },
      }),
    );
    const player = await ask(fetchImpl);
    expect(player.matches.every((m) => m.timeline !== null)).toBe(true);
    expect(calls.filter(isTimelineCall)).toHaveLength(4);
  });

  it("詳細の途中で回数制限にかかったら、タイムラインは取りにいかない", async () => {
    const { fetchImpl, calls } = fakeFetch(
      happyRoutes({ [`${MATCH}JP1_2`]: { status: 429, headers: { "Retry-After": "90" } } }),
    );
    const player = await ask(fetchImpl);
    expect(player.matches.map((m) => m.matchId)).toEqual(["JP1_3", "JP1_1"]);
    expect(player.matches.every((m) => m.timeline === null)).toBe(true);
    expect(calls.filter(isTimelineCall)).toHaveLength(0);
  });

  it("レベルとランクが取れなくても、試合は返す", async () => {
    const { fetchImpl } = fakeFetch(happyRoutes({ [SUMMONER]: { status: 500 }, [LEAGUE]: { status: 404 } }));
    const player = await ask(fetchImpl);
    expect(player.level).toBeNull();
    expect(player.rank).toBeNull();
    expect(player.matches).toHaveLength(3);
  });

  it("ソロ/デュオのランクが無ければ rank は null", async () => {
    const flex = [{ queueType: "RANKED_FLEX_SR", tier: "SILVER", rank: "I", leaguePoints: 10, wins: 1, losses: 2 }];
    const { fetchImpl } = fakeFetch(happyRoutes({ [LEAGUE]: { body: flex } }));
    expect((await ask(fetchImpl)).rank).toBeNull();
  });

  it("集計できる試合が1つも無ければ no-matches", async () => {
    const aram = happyRoutes({ [MATCH]: { body: fakeMatch({ info: { mapId: 12 } }) } });
    expect((await errorOf(ask(fakeFetch(aram).fetchImpl))).code).toBe("no-matches");
    const empty = happyRoutes({ [IDS]: { body: [] } });
    expect((await errorOf(ask(fakeFetch(empty).fetchImpl))).code).toBe("no-matches");
  });

  it("試合の詳細が全部失敗したら、no-matches ではなく upstream", async () => {
    const { fetchImpl } = fakeFetch(happyRoutes({ [MATCH]: { status: 503 } }));
    expect((await errorOf(ask(fetchImpl))).code).toBe("upstream");
  });

  it("つながらないときは upstream", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect((await errorOf(ask(fetchImpl))).code).toBe("upstream");
  });
});
