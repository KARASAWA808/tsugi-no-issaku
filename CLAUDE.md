# つぎの一作

3作×10問、各設問で好きな作品を好きなだけ(0〜3作)選んで好みを診断し、おすすめ作品を出す静的サイト。Vite + TypeScript、フレームワークなし。

- コマンド: `npm run dev` / `npm test` / `npm run build`(型チェック込み)
- ロジックは `src/quiz.ts`(進行)、`src/diagnose.ts`(採点)、`src/seen.ts`(見た作品と☆評価)に分離し、DOMに触れない。画面は `src/main.ts` だけが描画する。
- ☆評価は `src/main.ts` が localStorage に保存する(ブラウザごと、同期なし)。localStorage が使えなくてもメモリだけで動くようにする。
- 作品データは `src/catalog.ts`。追加時は既存タグを再利用し、ロジックを変えたら `tests/` も更新する。
- 画面の文言は日本語。色は `src/style.css` の `:root` のトークン経由で指定する(ライト/ダーク両対応)。
- AIによる診断は未実装(カタログ診断のみ)。入れる場合はAPIキーをブラウザに置かず、サーバー側の関数を経由させる。
