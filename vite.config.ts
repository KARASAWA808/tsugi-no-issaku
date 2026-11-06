import { defineConfig } from "vite";

// base を相対パスにしておくと、GitHub Pages の /リポジトリ名/ 配下でもそのまま動く
export default defineConfig({
  base: "./",
  // 取り込んだ作品(data/madb/tagged.json)は結果画面で初めて読む別チャンクで、500kB を超えるのが分かっている
  build: { chunkSizeWarningLimit: 1500 },
  // 大きな JSON は文字列のまま埋めて JSON.parse した方が、読み込みが軽い
  json: { stringify: true },
});
