import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { riotApiPlugin } from "./server/plugin";

// リポジトリのルートから `vite --config lol/vite.config.ts` で起動するので、場所はこのファイルから決める
const dir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // キーは lol/.env.local か環境変数から読む。VITE_ で始まらないので画面側のコードには入らない
  // (define や envPrefix で渡さないこと。ブラウザに届くと誰でも読めてしまう)
  const apiKey = loadEnv(mode, dir, "").RIOT_API_KEY || process.env.RIOT_API_KEY;

  return {
    root: dir,
    base: "./",
    plugins: [riotApiPlugin(apiKey)],
    // 自分のPCの中だけで使う。キーを使う /api をLANに出さないよう、host は 127.0.0.1 のままにする
    server: { host: "127.0.0.1", port: 5174, strictPort: false },
    build: { outDir: fileURLToPath(new URL("./dist", import.meta.url)), emptyOutDir: true },
  };
});
