import { defineConfig } from "vite";

// base を相対パスにしておくと、GitHub Pages の /リポジトリ名/ 配下でもそのまま動く
export default defineConfig({ base: "./" });
