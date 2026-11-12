// 開発サーバーに /api を生やす Vite プラグイン。APIキーはここ(Node 側)から外に出さない。
import type { ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import type { ApiError, PlayerData } from "../src/types";
import { PLATFORMS, RiotError, fetchPlayer, parseRiotId } from "./riot";

type Code = ApiError["error"];

const MATCH_COUNT = 20;
const DEFAULT_PLATFORM = "jp1";
// 開発用キーは2分で100回まで。1回の検索で20回以上使うので、再読み込みのたびに取り直さない
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 20;

const STATUS: Record<Code, number> = {
  "bad-request": 400,
  "bad-key": 401,
  "not-found": 404,
  "no-matches": 404,
  "rate-limit": 429,
  upstream: 502,
  "no-key": 503,
};

const MESSAGE: Record<Code, string> = {
  "bad-request": "Riot ID は「名前#タグ」の形で入力してください(例: なまえ#JP1)。",
  "bad-key": "APIキーが無効か、期限切れです。開発用キーは24時間で切れるので、発行し直して lol/.env.local を書きかえてください。",
  "not-found": "その Riot ID は見つかりませんでした。名前とタグ、サーバーを確かめてください。",
  "no-matches": "集計できる試合がありませんでした(サモナーズリフトの試合だけが対象です)。",
  "rate-limit": "Riot API の回数制限にかかりました。1〜2分待ってからもう一度試してください。",
  upstream: "Riot API からうまく取得できませんでした。少し待ってからもう一度試してください。",
  "no-key": "RIOT_API_KEY が設定されていません。lol/.env.local にキーを書くか、サンプルデータで試してください。",
};

function messageOf(error: RiotError): string {
  if (error.code === "rate-limit" && error.retryAfterSec && error.retryAfterSec > 1) {
    return `Riot API の回数制限にかかりました。約${Math.ceil(error.retryAfterSec)}秒待ってからもう一度試してください。`;
  }
  return MESSAGE[error.code];
}

function send(res: ServerResponse, status: number, body: PlayerData | ApiError | { hasKey: boolean }): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

const fail = (res: ServerResponse, code: Code, message = MESSAGE[code], status = STATUS[code]) =>
  send(res, status, { error: code, message });

export function riotApiPlugin(apiKey: string | undefined): Plugin {
  const key = apiKey?.trim() ?? "";
  const cache = new Map<string, { at: number; data: PlayerData }>();
  // 同じ人への問い合わせが重なったら(連打など)、1回ぶんにまとめる
  const inflight = new Map<string, Promise<PlayerData>>();

  function load(cacheKey: string, fetcher: () => Promise<PlayerData>): Promise<PlayerData> {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.data);
    const running = inflight.get(cacheKey);
    if (running) return running;

    const job = fetcher()
      .then((data) => {
        // Map は入れた順に並ぶので、入れ直してから先頭(いちばん古いもの)を捨てる
        cache.delete(cacheKey);
        cache.set(cacheKey, { at: Date.now(), data });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        return data;
      })
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, job);
    return job;
  }

  async function player(url: URL, res: ServerResponse): Promise<void> {
    if (!key) return fail(res, "no-key");
    const id = parseRiotId(url.searchParams.get("riotId") ?? "");
    if (!id) return fail(res, "bad-request");
    const platform = (url.searchParams.get("platform") || DEFAULT_PLATFORM).toLowerCase();
    if (!Object.hasOwn(PLATFORMS, platform)) return fail(res, "bad-request", "対応していないサーバーです。");

    const cacheKey = `${platform}:${id.gameName}#${id.tagLine}`.toLowerCase();
    try {
      const data = await load(cacheKey, () => fetchPlayer({ apiKey: key, ...id, platform, count: MATCH_COUNT }));
      send(res, 200, data);
    } catch (e) {
      if (e instanceof RiotError) return fail(res, e.code, messageOf(e));
      // 想定外の失敗。中身は画面に出さず、端末にだけ残す(キーはヘッダーでしか送らないので、ここには含まれない)
      console.error("[lol] /api/player:", e instanceof Error ? e.message : e);
      fail(res, "upstream");
    }
  }

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/player" && url.pathname !== "/api/status") return next();
    // ほかのサイトを開いているブラウザから勝手に叩かれて、回数制限を使われないようにする
    if (req.headers["sec-fetch-site"] === "cross-site") return fail(res, "bad-request", "このページ以外からは使えません。", 403);
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return fail(res, "bad-request", "GET だけに対応しています。", 405);
    }
    if (url.pathname === "/api/status") return send(res, 200, { hasKey: key !== "" });
    void player(url, res);
  };

  return {
    name: "lol-riot-api",
    configureServer(server) {
      // Vite 自身の処理(CORS や index.html の返却)より前に入るので、/api の応答に CORS ヘッダーは付かない
      server.middlewares.use(middleware);
    },
  };
}
