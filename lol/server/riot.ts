// Riot API を呼ぶ側。APIキーを扱うので Node(Vite の開発サーバー)の中だけで動かし、画面側からは import しない。
import type { ApiError, MatchStat, MatchTimeline, PlayerData, RankInfo, Role } from "../src/types";

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

const BLUE_TEAM = 100;

/** 対面 = 相手チームで同じ teamPosition の人。本人のロールが空、または相手にいなければ null */
function laneOpponentOf(players: readonly unknown[], me: Rec): Rec | null {
  const position = str(me.teamPosition);
  if (!position) return null;
  return players.filter(isRec).find((p) => p.teamId !== me.teamId && p.teamPosition === position) ?? null;
}

/** info.teams[] の1チームが取ったドラゴン・バロン・ヘラルドの合計 */
function teamObjectivesOf(team: Rec | undefined): number {
  const objectives = team && isRec(team.objectives) ? team.objectives : null;
  if (!objectives) return 0;
  return ["dragon", "baron", "riftHerald"].reduce((total, key) => {
    const entry = objectives[key];
    return total + (isRec(entry) ? num(entry.kills) : 0);
  }, 0);
}

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

  // 対面との差(自分 − 対面)。数え方は本人の cs / gold / damage と同じ
  const csOf = (p: Rec) => num(p.totalMinionsKilled) + num(p.neutralMinionsKilled);
  const opponent = laneOpponentOf(players, me);
  const teams = Array.isArray(info.teams) ? info.teams.filter(isRec) : [];

  // ピンは種類ごとに「〜Pings」という項目で入っている(パッチで種類が増減する)ので、名前で拾って足す
  const pings = Object.entries(me).reduce((total, [key, value]) => (key.endsWith("Pings") ? total + num(value) : total), 0);

  // 一度も死ななかった試合は longestTimeSpentLiving が 0 で返ってくる。そのときは試合の長さがそのまま答え
  const deaths = num(me.deaths);
  const longestLivingSec = deaths === 0 && num(me.longestTimeSpentLiving) === 0 ? durationSec : num(me.longestTimeSpentLiving);

  return {
    matchId,
    queueId: num(info.queueId),
    gameStart: num(info.gameStartTimestamp) || num(info.gameCreation),
    durationSec,
    win: me.win === true,
    role: ROLES.includes(position) ? (position as Role) : "UNKNOWN",
    champion,
    kills: num(me.kills),
    deaths,
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

    side: me.teamId === BLUE_TEAM ? "blue" : "red",
    level: num(me.champLevel),
    csDiff: opponent ? csOf(me) - csOf(opponent) : null,
    goldDiff: opponent ? num(me.goldEarned) - num(opponent.goldEarned) : null,
    damageDiff: opponent ? num(me.totalDamageDealtToChampions) - num(opponent.totalDamageDealtToChampions) : null,
    // 1=対面より上 0=そうでない。challenges が無い古い試合は分からない
    laneWon: challenges && has(challenges, "laningPhaseGoldExpAdvantage") ? num(challenges.laningPhaseGoldExpAdvantage) > 0 : null,
    turretPlates: challenges ? num(challenges.turretPlatesTaken) : 0,
    objectiveDamage: num(me.damageDealtToObjectives),
    teamObjectives: teamObjectivesOf(teams.find((t) => t.teamId === me.teamId)),
    healShield: num(me.totalHealsOnTeammates) + num(me.totalDamageShieldedOnTeammates),
    ccSec: num(me.timeCCingOthers),
    skillshotsDodged: challenges ? num(challenges.skillshotsDodged) : 0,
    epicSteals: challenges ? num(challenges.epicMonsterSteals) : 0,
    pings,
    missingPings: num(me.enemyMissingPings),
    surrendered: me.gameEndedInSurrender === true && me.win !== true,
    longestLivingSec,
    // タイムラインは別の呼び出しなので、ここでは空。fetchPlayer が slimTimeline の結果を入れる
    timeline: null,
  };
}

// ---- タイムラインの切り出し ----

const MINUTE_MS = 60_000;
/** フレームの時刻は数十ミリ秒ずれるので、このぶんは「その分のフレーム」とみなす */
const FRAME_SLACK_MS = 5_000;
/** サモナーズリフトの座標は青の本拠地がほぼ (0,0)、赤がほぼ (14870,14980)。x+y がこの値のあたりが川 */
const RIVER_DIAGONAL = 14_900;
/** 川からこれより先に入ったところを「相手側の陣地」とする */
const DEEP_BAND = 2_000;

/**
 * match-v5 のタイムライン(/timeline)から、puuid の本人のぶんだけ抜き出す。
 * チームと対面を知るために、同じ試合の match も渡す。形が壊れている・本人がいないときは null。
 */
export function slimTimeline(timeline: unknown, match: unknown, puuid: string): MatchTimeline | null {
  if (!isRec(timeline) || !isRec(timeline.info) || !Array.isArray(timeline.info.frames)) return null;
  if (!isRec(match) || !isRec(match.info) || !Array.isArray(match.info.participants)) return null;
  // 番号(= 分)で引くので、並びはそのまま持っておく
  const rawFrames: unknown[] = timeline.info.frames;
  const frames = rawFrames.filter(isRec);
  if (frames.length === 0) return null;
  // 別の試合のタイムラインを取りちがえていたら使わない
  const ids = [timeline.metadata, match.metadata].map((meta) => (isRec(meta) ? str(meta.matchId) : ""));
  if (ids[0] && ids[1] && ids[0] !== ids[1]) return null;

  const seats: unknown[] = match.info.participants;
  const me = seats.find((p): p is Rec => isRec(p) && p.puuid === puuid);
  if (!me) return null;

  // タイムラインの中の番号(1〜10)。タイムラインの対応表 → match の participantId → 並び順、の順で探す
  const table = Array.isArray(timeline.info.participants) ? timeline.info.participants.filter(isRec) : [];
  const seatOf = (player: Rec): number => {
    const listed = table.find((p) => p.puuid === player.puuid && str(p.puuid) !== "");
    if (listed && num(listed.participantId) >= 1) return num(listed.participantId);
    return num(player.participantId) >= 1 ? num(player.participantId) : seats.indexOf(player) + 1;
  };
  const myId = seatOf(me);
  const opponent = laneOpponentOf(seats, me);
  const opponentId = opponent ? seatOf(opponent) : null;

  /** frames[minute] の、ある人の記録。その分まで試合が続いていなければ null */
  const frameOf = (minute: number, id: number): Rec | null => {
    const frame = rawFrames[minute];
    if (!isRec(frame) || !isRec(frame.participantFrames)) return null;
    // 最後のフレームは試合が終わった瞬間のもの。9分40秒で終わった試合の frames[10] は「10分時点」ではない
    if (has(frame, "timestamp") && num(frame.timestamp) < minute * MINUTE_MS - FRAME_SLACK_MS) return null;
    const mine = frame.participantFrames[String(id)];
    return isRec(mine) ? mine : null;
  };
  const diffAt = (minute: number, value: (frame: Rec) => number | null): number | null => {
    if (opponentId === null) return null;
    const mine = frameOf(minute, myId);
    const theirs = frameOf(minute, opponentId);
    const a = mine && value(mine);
    const b = theirs && value(theirs);
    return typeof a === "number" && typeof b === "number" ? a - b : null;
  };
  const goldOf = (frame: Rec) => (has(frame, "totalGold") ? num(frame.totalGold) : null);
  const csOf = (frame: Rec) =>
    has(frame, "minionsKilled") || has(frame, "jungleMinionsKilled")
      ? num(frame.minionsKilled) + num(frame.jungleMinionsKilled)
      : null;

  const blue = me.teamId === BLUE_TEAM;
  let takedowns10 = 0;
  const deaths: { at: number; solo: boolean; deep: boolean }[] = [];
  for (const frame of frames) {
    if (!Array.isArray(frame.events)) continue;
    for (const event of frame.events) {
      if (!isRec(event) || event.type !== "CHAMPION_KILL" || !has(event, "timestamp")) continue;
      const at = num(event.timestamp);
      // アシストが無いキルでは、assistingParticipantIds そのものが省かれる
      const assists: unknown[] = Array.isArray(event.assistingParticipantIds) ? event.assistingParticipantIds : [];
      if (event.victimId === myId) {
        // killerId 0 はタワーやモンスターに倒された(エクスキュート)。1人にやられたとは数えない
        const byChampion = Number.isInteger(event.killerId) && num(event.killerId) >= 1 && num(event.killerId) <= 10;
        const where = isRec(event.position) && has(event.position, "x") && has(event.position, "y")
          ? num(event.position.x) + num(event.position.y)
          : null;
        const deep = where !== null && (blue ? where > RIVER_DIAGONAL + DEEP_BAND : where < RIVER_DIAGONAL - DEEP_BAND);
        deaths.push({ at, solo: byChampion && assists.length === 0, deep });
      } else if (at < 10 * MINUTE_MS && (event.killerId === myId || assists.includes(myId))) {
        takedowns10++;
      }
    }
  }
  deaths.sort((a, b) => a.at - b.at);

  return {
    goldDiff10: diffAt(10, goldOf),
    goldDiff15: diffAt(15, goldOf),
    csDiff10: diffAt(10, csOf),
    takedowns10,
    deathMinutes: deaths.map((d) => Math.round(d.at / (MINUTE_MS / 10)) / 10),
    soloDeaths: deaths.filter((d) => d.solo).length,
    deepDeaths: deaths.filter((d) => d.deep).length,
  };
}

// ---- Riot API ----

const MAX_COUNT = 30;
/**
 * 開発用キーは1秒20回・2分100回まで。試合の詳細とタイムラインを一度に取りにいく数をしぼっておく。
 * 20試合を調べると、1回の検索で 4(アカウント・レベル・ランク・試合ID)+ 20(詳細)+ 20(タイムライン)= 約44回。
 * 2分のあいだに3回目を調べると、途中で回数制限にかかる。
 */
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

/** 0 〜 count-1 の番号を、同時に limit 個までで順に job へ渡す。stop() が true になったら、残りは始めない */
async function eachLimited(
  count: number,
  limit: number,
  stop: () => boolean,
  job: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!stop() && next < count) await job(next++);
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
}

/** 残りを打ち切るべき失敗(キーが無効=続けても全部失敗、回数制限=続けるほど長引く)なら、そのエラーを返す */
function fatalOf(e: unknown): RiotError | null {
  return e instanceof RiotError && (e.code === "bad-key" || e.code === "rate-limit") ? e : null;
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
  // raw はタイムラインの切り出し(チームと対面を調べる)に使うので、取っておく
  const found: ({ id: string; stat: MatchStat; raw: unknown } | null)[] = new Array(ids.length).fill(null);
  let fatal: RiotError | null = null;
  let failures = 0;
  await eachLimited(ids.length, DETAIL_CONCURRENCY, () => fatal !== null, async (index) => {
    const id = ids[index];
    try {
      const raw = await get(region, `/lol/match/v5/matches/${enc(id)}`);
      const stat = slimMatch(raw, puuid);
      if (stat) found[index] = { id, stat, raw };
    } catch (e) {
      failures++;
      fatal ??= fatalOf(e);
    }
  });

  const stopped = fatal as RiotError | null;
  if (stopped?.code === "bad-key") throw stopped;

  const kept = found.filter((m) => m !== null);
  if (kept.length === 0) {
    // 1試合も読めなかった理由が通信側にあるなら、「試合がない」とは言わない
    if (stopped) throw stopped;
    if (failures > 0) throw new RiotError("upstream", "試合の詳細を取得できませんでした");
    throw new RiotError("no-matches", "集計できる試合がありません");
  }

  // タイムラインは、くわしい解析のためのおまけ。取れなかった試合は timeline が null のまま、試合そのものは返す。
  // 回数制限にかかったら(詳細の時点でかかっていた場合も)残りは取りにいかない。新しい試合から順に取るので、欠けるのは古い側。
  // キーが無効なときだけは、詳細と同じく全体を bad-key で止める
  let halted: RiotError | null = stopped;
  await eachLimited(kept.length, DETAIL_CONCURRENCY, () => halted !== null, async (index) => {
    const { id, stat, raw } = kept[index];
    try {
      stat.timeline = slimTimeline(await get(region, `/lol/match/v5/matches/${enc(id)}/timeline`), raw, puuid);
    } catch (e) {
      halted ??= fatalOf(e);
    }
  });
  const timelineStop = halted as RiotError | null;
  if (timelineStop?.code === "bad-key") throw timelineStop;

  const matches = kept.map((m) => m.stat).sort((a, b) => b.gameStart - a.gameStart);

  return {
    // 大文字小文字や空白は、Riot に登録されている表記に合わせる
    gameName: str(account.gameName) || opts.gameName,
    tagLine: str(account.tagLine) || opts.tagLine,
    level,
    rank,
    matches,
  };
}
