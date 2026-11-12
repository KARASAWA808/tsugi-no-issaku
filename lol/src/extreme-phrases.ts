// 過激な口ぐせ(実際の発言)。画面で「過激な口ぐせも混ぜる」にチェックを入れたときだけ使う。最初はオフ。
//   - 死や暴力を願う言葉(「しね」など)
//   - 見た目へのいじり(成績とは関係なく飛んでくる)
// 分けてある理由: 自分以外の Riot ID を見たときや、画面をほかの人に見せたときに、そのまま出ないようにするため。
// ここにも入れないもの: ほかの実在の人の名前、性別をけなすもの(本人へのいじりではなく、ある性別の人みんなをけなす内容になるため)。
// 表記は「らいさまちくちく集」から機械的に写した。変えたものは source にそう書いてある。
import type { PhraseBook } from "./phrases";

export const EXTREME_PHRASES: PhraseBook = {
  opening: [
  ],
  accept: [
  ],
  reject: [
    {"text": "しね。しねしねしね", "source": "らいさまちくちく集 No.189", "weight": 4},
    {"text": "しね", "source": "らいさまちくちく集 No.333", "weight": 4},
    {"text": "カス、しね…ボケ！何をどうしたらこうなるんだ", "source": "らいさまちくちく集 No.96", "weight": 4},
    {"text": "余裕、死ね", "source": "らいさまちくちく集 No.413", "weight": 4},
    {"text": "〇ね", "source": "らいさまちくちく集 No.663", "weight": 4},
    {"text": "しねしねしね！…あぁｶﾞﾋﾞ", "source": "らいさまちくちく集 No.291", "weight": 4},
  ],
  roast: [
    {"text": "カスが。しんどけ", "after": true, "source": "らいさまちくちく集 No.318", "weight": 4},
    {"text": "死んどけマジで", "after": true, "source": "らいさまちくちく集 No.636", "weight": 4},
    {"text": "もう十分。しょうがない。4ね。", "after": true, "source": "らいさまちくちく集 No.613", "weight": 4},
    {"text": "ボタン全部押して死ね", "after": true, "source": "らいさまちくちく集 No.804", "weight": 4},
    {"text": "誰かここで死んでくんねぇかな", "after": true, "source": "らいさまちくちく集 No.812", "weight": 4},
    {"text": "ｯﾁもうマージでさぁ…死んでくれ！！あっ死んだわ…", "source": "らいさまちくちく集 No.164", "weight": 4},
    {"text": "馬鹿が、死ね！お前とパワースパイクがちげぇんだよ死ね！", "topic": ["behind15", "solodeath", "earlydeath", "feeder", "coinflip"], "source": "らいさまちくちく集 No.786", "weight": 4},
    {"text": "お前が死ねよ", "after": true, "topic": ["afk", "noobjective", "lowdamage"], "source": "らいさまちくちく集 No.486(抜粋)", "weight": 4},
    {"text": "死ね馬鹿！うるせえうるせえお前は3回殺すって決めてんだ。おい黙れ", "topic": ["feeder", "earlydeath", "deepdeath", "solodeath", "grayscreen"], "source": "らいさまちくちく集 No.455(抜粋)", "weight": 4},
    {"text": "56せるだろ。何やってるんだ？", "topic": ["lowdamage", "kdaplayer"], "source": "らいさまちくちく集 No.294", "weight": 4},
  ],
  verdictHigh: [
  ],
  verdictLow: [
    {"text": "俺は絶対にコイツをぶん殴るから！", "after": true, "grades": ["C", "D"], "source": "らいさまちくちく集 No.87(言い回しを一部改変)", "weight": 4},
    {"text": "兄弟だったらマジ56してるけどなこんなん", "after": true, "grades": ["C", "D"], "source": "らいさまちくちく集 No.615", "weight": 4},
    {"text": "馬鹿なんじゃねえの？死ね本当に", "after": true, "grades": ["C", "D"], "source": "らいさまちくちく集 No.784(抜粋)", "weight": 4},
  ],
  homework: [
  ],
  aside: [
    {"text": "デブに救いはないよ、ないない", "source": "らいさまちくちく集 No.78", "weight": 4},
    {"text": "お腹が出てるってそれは！", "source": "らいさまちくちく集 No.235", "weight": 4},
    {"text": "なんか太くね？", "source": "らいさまちくちく集 No.178", "weight": 4},
    {"text": "お前でっか！", "source": "らいさまちくちく集 No.260", "weight": 4},
    {"text": "お前だ、メガネ", "source": "らいさまちくちく集 No.352", "weight": 4},
    {"text": "帰ろ。顔キモ", "source": "らいさまちくちく集 No.460", "weight": 4},
    {"text": "牡蠣みたいな服", "source": "らいさまちくちく集 No.76", "weight": 4},
    {"text": "ブタやね", "source": "らいさまちくちく集 No.789", "weight": 4},
    {"text": "お～初めてみた、ぶっさ", "source": "らいさまちくちく集 No.423", "weight": 4},
    {"text": "やばいね...ｗ、ちょっと年齢感じたけどｗ", "source": "らいさまちくちく集 No.553", "weight": 4},
    {"text": "あとたぶん15kg太れる", "source": "らいさまちくちく集 No.328(抜粋)", "weight": 4},
    {"text": "キモいなーマジで。口くっさ。", "source": "らいさまちくちく集 No.462(抜粋)", "weight": 4},
    {"text": "ガチきしょダリウス顔キモ。ファッキュー", "champion": "Darius", "source": "らいさまちくちく集 No.116", "weight": 4},
  ],
};
