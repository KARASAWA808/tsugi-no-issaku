// Riot API を呼ぶ側。APIキーを扱うので Node(Vite の開発サーバー)の中だけで動かし、画面側からは import しない。
import type { ApiError, MatchStat, PlayerData, RankInfo, Role } from "../src/types";

export type Region = "americas" | "asia" | "europe" | "sea";

/**
 * プラットフォーム(サーバー)→ 地域ルーティング。
 * account-v1 と match-v5 は地域ホスト、summoner-v4 と league-v4 はプラットフォームのホストに聞く。
 */
export const PLATFORMS: Readonly<Record<string, Region>> = {
  jp1: "asia",
  kr: "asia",
  na1: "americas",
  br1: "americas",
  la1: "americas",
  la2: "americas",
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  ru: "europe",
  me1: "europe",
  oc1: "sea",
  sg2: "sea",
  tw2: "sea",
  vn2: "sea",
};

/** 失敗の種類を ApiError のコードで運ぶ。メッセージにAPIキーは入れない */
export class RiotError extends Error {
  readonly code: ApiError["error"];
  /** Riot が返した HTTP ステータス(つながらなかったときは無い) */
  readonly status?: number;
  /** 429 のとき、Riot が指定した待ち時間(秒) */
  readonly retryAfterSec?: number;

  constructor(code: ApiError["error"], message: string, extra: { status?: number; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "RiotError";
    this.code = code;
    this.status = extra.status;
    this.retryAfterSec = extra.retryAfterSec;
  }
}

// ---- Riot ID ----

const NAME_MIN = 3;
const NAME_MAX = 16;
// タグは英数字3〜5文字。日本語やハングルのタグも実在するので、文字種は Unicode の文字・数字まで許す
const TAG_PATTERN = /^[\p{L}\p{N}]{3,5}$/u;

/** 「名前#JP1」を名前とタグに分ける。タグが無い・長さが合わないものは null */
export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const text = input.replace(/＃/g, "#").trim();
  const at = text.lastIndexOf("#");
  if (at < 0) return null;
  const gameName = text.slice(0, at).trim();
  // タグだけは全角英数で打たれても通す(名前は Riot 側の表記のまま送りたいので触らない)
  const tagLine = text.slice(at + 1).trim().normalize("NFKC");
  // 絵文字などを1文字と数えるため、コードポイントで数える
  const length = [...gameName].length;
  if (length < NAME_MIN || length > NAME_MAX || gameName.includes("#")) return null;
  if (!TAG_PATTERN.test(tagLine)) return null;
  return { gameName, tagLine };
}

// ---- 試合データの切り出し ----

const SUMMONERS_RIFT = 11;
/** これより短い試合はリメイクとして数えない */
const REMAKE_SEC = 5 * 60;
const ROLES: readonly string[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const has = (rec: Rec, key: string): boolean => typeof rec[key] === "number";

/**
 * match-v5 の1試合から、puuid の本人の成績だけを抜き出す。
 * 本人がいない・サモナーズリフト以外・リメイク・形が壊れている試合は null。
 */
export function slimMatch(match: unknown, puuid: string): MatchStat | null {
  if (!isRec(match) || !isRec(match.metadata) || !isRec(match.info)) return null;
  const { metadata, info } = match;
  const matchId = str(metadata.matchId);
  if (!matchId || info.mapId !== SUMMONERS_RIFT || !Array.isArray(info.participants)) return null;

  const players = info.participants.filter(isRec);
  const me = players.find((p) => p.puuid === puuid);
  if (!me) return null;

  // 古いパッチ(11.20より前)は gameEndTimestamp が無く、gameDuration がミリ秒で入っている
  const durationSec = has(info, "gameEndTimestamp")
    ? num(info.gameDuration)
    : Math.round(num(info.gameDuration) / 1000);
  if (me.gameEndedInEarlySurrender === true || durationSec < REMAKE_SEC) return null;

  const team = players.filter((p) => p.teamId === me.teamId);
  const sum = (key: string) => team.reduce((total, p) => total + num(p[key]), 0);
  const challenges = isRec(me.challenges) ? me.challenges : null;

  // 10分時点のCSは challenges にしか無い。ジャングルの分は小数で返ってくるので丸める
  const csAt10 = challenges && has(challenges, "laneMinionsFirst10Minutes")
    ? Math.round(num(challenges.laneMinionsFirst10Minutes) + num(challenges.jungleCsBefore10Minutes))
    : null;

  // challenges があれば「絡んだ数」(アシスト込み)。無ければ自分でとどめを刺した数で代用する
  const takedowns = ["dragonTakedowns", "baronTakedowns", "riftHeraldTakedowns"];
  const objectives = challenges && takedowns.some((key) => has(challenges, key))
    ? takedowns.reduce((total, key) => total + num(challenges[key]), 0)
    : num(me.dragonKills) + num(me.baronKills);

  const position = str(me.teamPosition);
  // match-v5 だけ "FiddleSticks" と返す。Data Dragon のIDは "Fiddlesticks"
  const champion = str(me.championName) === "FiddleSticks" ? "Fiddlesticks" : str(me.championName);

  return {
    matchId,
    queueId: num(info.queueId),
    gameStart: num(info.gameStartTimestamp) || num(info.gameCreation),
    durationSec,
    win: me.win === true,
    role: ROLES.includes(position) ? (position as Role) : "UNKNOWN",
    champion,
    kills: num(me.kills),
    deaths: num(me.deaths),
    assists: num(me.assists),
    cs: num(me.totalMinionsKilled) + num(me.neutralMinionsKilled),
    gold: num(me.goldEarned),
    damage: num(me.totalDamageDealtToChampions),
    damageTaken: num(me.totalDamageTaken),
    visionScore: num(me.visionScore),
    wardsPlaced: num(me.wardsPlaced),
    wardsKilled: num(me.wardsKilled),
    controlWards: num(me.visionWardsBoughtInGame),
    teamKills: sum("kills"),
    teamDamage: sum("totalDamageDealtToChampions"),
    firstBlood: me.firstBloodKill === true || me.firstBloodAssist === true,
    soloKills: challenges ? num(challenges.soloKills) : 0,
    csAt10,
    objectives,
    turretTakedowns: num(me.turretTakedowns),
    largestMultiKill: num(me.largestMultiKill),
    timeDeadSec: num(me.totalTimeSpentDead),
  };
}

// ---- Riot API ----

const MAX_COUNT = 30;
/** 開発用キーは1秒20回まで。試合の詳細を一度に取りにいく数をしぼっておく */
const DETAIL_CONCURRENCY = 5;
const MAX_RETRY = 2;
const MAX_WAIT_MS = 10_000;
const TIMEOUT_MS = 10_000;
const SOLO_QUEUE = "RANKED_SOLO_5x5";

interface Client {
  apiKey: string;
  fetchImpl: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const enc = encodeURIComponent;

/** Retry-After(秒)。無い・読めないときは1秒 */
function retryAfterSec(res: Response): number {
  const sec = Number(res.headers.get("retry-after"));
  return Number.isFinite(sec) && sec >= 0 ? sec : 1;
}

/** GET して JSON を返す。キーはヘッダーで送り、URL やエラーメッセージには出さない */
async function riotGet(client: Client, host: string, path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await client.fetchImpl(`https://${host}.api.riotgames.com${path}`, {
        headers: { "X-Riot-Token": client.apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // fetch の例外はそのまま投げず、決まった文言に置きかえる
      throw new RiotError("upstream", "Riot API につながりませんでした");
    }

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        throw new RiotError("upstream", "Riot API の応答を読めませんでした", { status: res.status });
      }
    }
    // 読まない本文は捨てて、接続を返す
    await res.body?.cancel().catch(() => undefined);

    if (res.status === 401 || res.status === 403) {
      throw new RiotError("bad-key", "APIキーが無効か、期限切れです", { status: res.status });
    }
    if (res.status === 429) {
      const sec = retryAfterSec(res);
      // 上限より長く待てと言われたら、待っても早すぎて通らない。すぐあきらめて待ち時間を伝える
      if (attempt >= MAX_RETRY || sec * 1000 > MAX_WAIT_MS) {
        throw new RiotError("rate-limit", "Riot API の回数制限にかかりました", { status: 429, retryAfterSec: sec });
      }
      await sleep(sec * 1000);
      continue;
    }
    throw new RiotError("upstream", `Riot API が ${res.status} を返しました`, { status: res.status });
  }
}

function levelOf(summoner: unknown): number | null {
  return isRec(summoner) && has(summoner, "summonerLevel") ? num(summoner.summonerLevel) : null;
}

function rankOf(entries: unknown): RankInfo | null {
  if (!Array.isArray(entries)) return null;
  const solo = entries.filter(isRec).find((e) => e.queueType === SOLO_QUEUE);
  if (!solo || !str(solo.tier)) return null;
  return {
    tier: str(solo.tier),
    division: str(solo.rank) || "I",
    lp: num(solo.leaguePoints),
    wins: num(solo.wins),
    losses: num(solo.losses),
  };
}

function clampCount(count: number): number {
  return Number.isFinite(count) ? Math.min(MAX_COUNT, Math.max(1, Math.trunc(count))) : 1;
}

/** Riot ID から、レベル・ランク・直近の試合(新しい順)を集める */
export async function fetchPlayer(opts: {
  apiKey: string;
  gameName: string;
  tagLine: string;
  platform: string;
  count: number;
  fetchImpl?: typeof fetch;
}): Promise<PlayerData> {
  const platform = opts.platform.toLowerCase();
  if (!Object.hasOwn(PLATFORMS, platform)) throw new RiotError("bad-request", "対応していないサーバーです");
  const region = PLATFORMS[platform];
  // account-v1 には sea のホストが無い。アカウントはどの地域で聞いても同じ答えなので、近い asia に聞く
  const accountRegion = region === "sea" ? "asia" : region;
  const client: Client = { apiKey: opts.apiKey, fetchImpl: opts.fetchImpl ?? fetch };
  const get = (host: string, path: string) => riotGet(client, host, path);

  const account = await get(
    accountRegion,
    `/riot/account/v1/accounts/by-riot-id/${enc(opts.gameName)}/${enc(opts.tagLine)}`,
  ).catch((e: unknown) => {
    if (e instanceof RiotError && e.status === 404) throw new RiotError("not-found", "Riot ID が見つかりません", { status: 404 });
    throw e;
  });
  const puuid = isRec(account) ? str(account.puuid) : "";
  if (!isRec(account) || !puuid) throw new RiotError("upstream", "アカウントの応答に puuid がありません");
  const who = enc(puuid);

  // レベルとランクは飾りなので、取れなくても試合の集計は続ける
  const [level, rank, idList] = await Promise.all([
    get(platform, `/lol/summoner/v4/summoners/by-puuid/${who}`).then(levelOf, () => null),
    get(platform, `/lol/league/v4/entries/by-puuid/${who}`).then(rankOf, () => null),
    get(region, `/lol/match/v5/matches/by-puuid/${who}/ids?start=0&count=${clampCount(opts.count)}`),
  ]);
  const ids = Array.isArray(idList) ? idList.filter((id): id is string => typeof id === "string") : [];

  // 1試合の失敗では全体を止めない。キーが無効(続けても全部失敗)と回数制限(続けるほど長引く)だけは残りを打ち切る
  const found: (MatchStat | null)[] = new Array(ids.length).fill(null);
  let fatal: RiotError | null = null;
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (!fatal && next < ids.length) {
      const index = next++;
      try {
        found[index] = slimMatch(await get(region, `/lol/match/v5/matches/${enc(ids[index])}`), puuid);
      } catch (e) {
        failures++;
        if (e instanceof RiotError && (e.code === "bad-key" || e.code === "rate-limit")) fatal ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker));

  const stopped = fatal as RiotError | null;
  if (stopped?.code === "bad-key") throw stopped;

  const matches = found
    .filter((m): m is MatchStat => m !== null)
    .sort((a, b) => b.gameStart - a.gameStart);
  if (matches.length === 0) {
    // 1試合も読めなかった理由が通信側にあるなら、「試合がない」とは言わない
    if (stopped) throw stopped;
    if (failures > 0) throw new RiotError("upstream", "試合の詳細を取得できませんでした");
    throw new RiotError("no-matches", "集計できる試合がありません");
  }

  return {
    // 大文字小文字や空白は、Riot に登録されている表記に合わせる
    gameName: str(account.gameName) || opts.gameName,
    tagLine: str(account.tagLine) || opts.tagLine,
    level,
    rank,
    matches,
  };
}
