import { describe, expect, it } from "vitest";
import { PLATFORMS, RiotError, fetchPlayer, parseRiotId, slimMatch } from "../lol/server/riot";

const ME = "puuid-me";
const KEY = "RGAPI-test-key";

type Rec = Record<string, unknown>;

/** 味方4人+敵5人のうちの1人。本人以外は集計に使う項目だけ持たせる */
const other = (index: number, teamId: number): Rec => ({
  puuid: `puuid-${teamId}-${index}`,
  teamId,
  kills: 2,
  totalDamageDealtToChampions: 10000,
});

/** match-v5 の試合。本人(ME)は青チーム(100)のミッド */
function fakeMatch(opts: { id?: string; start?: number; info?: Rec; me?: Rec } = {}): Rec {
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
    challenges: {
      soloKills: 2,
      laneMinionsFirst10Minutes: 78,
      dragonTakedowns: 2,
      baronTakedowns: 1,
      riftHeraldTakedowns: 1,
    },
    ...opts.me,
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
        ...[1, 2, 3, 4].map((i) => other(i, 100)),
        ...[1, 2, 3, 4, 5].map((i) => other(i, 200)),
      ],
      ...opts.info,
    },
  };
}

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

// ---- fetchPlayer: 本物の Riot API は呼ばず、URL ごとに決めた応答を返す fetch で確かめる ----

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };
type Route = Reply | ((url: URL, hit: number) => Reply);

const ACCOUNT = "/riot/account/v1/accounts/by-riot-id/";
const SUMMONER = "/lol/summoner/v4/summoners/by-puuid/";
const LEAGUE = "/lol/league/v4/entries/by-puuid/";
const IDS = `/lol/match/v5/matches/by-puuid/${ME}/ids`;
const MATCH = "/lol/match/v5/matches/";

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
    [MATCH]: (url) => {
      const id = url.pathname.slice(MATCH.length);
      return { body: fakeMatch({ id, start: 1_700_000_000_000 + Number(id.slice(4)) * 3_600_000 }) };
    },
    ...extra,
  };
}

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

    // キーは全部の呼び出しにヘッダーで付け、URL には出さない
    expect(calls).toHaveLength(7);
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
