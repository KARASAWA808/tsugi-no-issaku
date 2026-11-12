// 「言いそうな台詞」として作った口ぐせ。ご本人が実際に言ったものではない。
//
// 実際の発言(phrases.ts の BUILTIN_PHRASES。出典つき)とは、かならず分けて置く。
// ここにあるのは、実際の発言に見られる話し方の傾向から連想して作ったもの:
//   - 「…まあいいや」で話を投げる
//   - 同じ言葉の連呼(「ドラゴンドラゴンドラゴン」「ワードワードワード」)
//   - 「〜なんだよね」「マジで」「普通に」「ホントに」で締める
//   - 「〜ですか?」「〜でーす」という丁寧語の皮肉
//   - 「えらいえらい」「〜おいちい」という赤ちゃん言葉の褒め方
//   - 「〜した方がいい」「〜やめてほしい」「〜って話」という言い切り
// 選ぶときの決まりは実際の発言と同じ(ほかの実在の人の名前、死や暴力を願う言葉、容姿・性別に触れるものは入れない)。
import type { Grade } from "./analyze";
import { PLAY_TOPICS, type Phrase, type PhraseBook, type PhraseTopic } from "./phrases";
import type { Role } from "./types";

const SOURCE = "創作(話し方の傾向からの連想。実際の発言ではない)";
type Extra = { after?: boolean; role?: Role; topic?: PhraseTopic | readonly PhraseTopic[]; grades?: readonly Grade[] };
/** きつい言い回し。評価が C・D の人にだけ */
const LOW: Extra = { grades: ["C", "D"] };
/** 皮肉まじりの言い回し。S・A の人には出さない */
const NOT_HIGH: Extra = { grades: ["B", "C", "D"] };
const make = (text: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: SOURCE, imagined: true });
const after = (text: string, extra: Extra = {}): Phrase => make(text, { ...extra, after: true });
/** その話題の評価文の前に付ける */
const on = (topic: PhraseTopic, text: string): Phrase => make(text, { topic });
/** その話題の評価文の後ろに付ける */
const onAfter = (topic: PhraseTopic, text: string): Phrase => make(text, { topic, after: true });

export const IMAGINED_PHRASES: PhraseBook = {
  opening: [
    // 本文も「はい、」「どうも、」で始まることがあるので、あいさつにならない言い方にする
    after("じゃあ見ていきまーす"),
    make("えーっと…まあいいや、見るわ"),
    make("ｯﾁ…"),
    make("あの～、これ本当に見なきゃダメですか？", NOT_HIGH),
    make("お、来たね。覚悟はできてる？"),
    make("あ～はいはいはい、こういうタイプね"),
    make("先に言っとくけど、優しくはしないよ"),
  ],
  accept: [
    make("お、いいじゃん"),
    make("うん、それは本当"),
    make("ナイス。普通にナイス"),
    make("やればできるじゃん"),
    make("へー、やるね"),
    make("そこはちゃんとしてる。そこはね"),
    make("いいね、そういうのでいいんだよ"),
    make("はい、それは認めまーす"),
    on("kda", "死なないのはえらい。普通にえらい"),
    on("cs", "ミニオンちゃんと取れてる、えらい"),
    on("vision", "ワード置けてる。置けてる置けてる"),
    on("teamfight", "ちゃんといるじゃん、えらい"),
    on("damage", "殴れてるね、ちゃんと殴れてる"),
    on("solokill", "対面こわしてるじゃん、いいね"),
    on("survive", "生きてるだけでえらいんだよね、このゲーム"),
    on("objective", "ドラゴン寄れてる、えらいえらい"),
    on("onetrick", "その1体はホントに上手い。その1体はね"),
    on("winrate", "勝ってる人が正しいんだよね、結局"),
    on("firstblood", "序盤から動けてる、いいじゃん"),
    on("pool", "いろいろ使えてえらいね～"),
    on("lanewin", "レーンは強い。レーンはね"),
    on("comeback", "あきらめないのはえらい。普通に"),
    on("lategame", "終盤わかってるじゃん"),
    on("plates", "プレートおいちいね～"),
    on("healer", "回復えらい、回復えらい"),
    on("cc", "ナイスCC、それでいい"),
    on("dodger", "避ける避ける、えらい"),
    on("form", "調子いいじゃん、今のうちに勝っとけ"),
    on("steal", "スティールはナイス。狙ったかは聞かない"),
  ],
  reject: [
    make("いやいやいや"),
    make("それは違うでしょ、マジで"),
    make("はい、ダメでーす"),
    make("あのさぁ…まあいいや"),
    make("本気で言ってる？それ"),
    make("言ってることとやってることが違うんだよね"),
    make("ｯﾁ、言い訳が長い"),
    make("それ、俺の前で言う？"),
    make("浅い。浅すぎる"),
    make("うん、聞かなかったことにするわ"),
    make("はい？ もう一回言ってみて"),
    make("それを強みって呼ぶの、やめてほしい"),
    on("spirit", "気持ちの話はしてないんだよね"),
    on("spirit", "数字は？ ねえ、数字"),
    on("feeder", "死にすぎ。普通に死にすぎ"),
    on("grayscreen", "灰色の画面、好きなの？"),
    on("lowcs", "ミニオン取って、ミニオン。ミニオンミニオンミニオン"),
    on("loselane", "10分でもう差ついてんじゃん"),
    on("blind", "見えてないんだよね、何も"),
    on("nopink", "コントロールワード買って。買って買って買って"),
    on("afk", "どこにいるの？ ねえ、どこ？"),
    on("lowdamage", "殴って？ ねえ殴って？"),
    on("coinflip", "安定って言葉、知ってる？"),
    on("tourist", "チャンピオン決めな？ マジで"),
    on("losing", "勝ててないんだよね、結局"),
    on("nomad", "ロール決めて。まずそこから"),
    on("noobjective", "ドラゴン寄って。ドラゴンドラゴンドラゴン"),
    on("behind15", "15分でもう負けてんじゃん、マジで"),
    on("earlydeath", "早い早い早い、死ぬのが早い"),
    on("deepdeath", "なんでそこにいるの？ なんで？"),
    on("solodeath", "1対1で負けてんじゃん。それガンクのせいじゃないよ"),
    on("thrower", "勝ってる試合を落とすのが一番意味わからん、マジで"),
    on("tilt", "負けてすぐキュー押すのやめな？ マジで"),
    on("marathon", "やりすぎ。普通にやりすぎ"),
    on("nightloss", "寝ろ。マジで寝ろ"),
    on("ff", "降参降参降参、すぐ降参"),
    on("pinger", "ピンピンピンピンうるさいんだよね"),
    on("slump", "最近どうした？ ホントに"),
    on("sidegap", "片側だけ別人じゃん"),
    on("latelose", "終盤なにしていいか分かってないでしょ"),
    on("badchamp", "そのチャンピオンやめな？ 普通に"),
  ],
  roast: [
    make("あとさぁ、"),
    make("ついでに言うと、"),
    make("これも言っとくわ、"),
    make("まだあるよ、"),
    after("意味わからん、ホントに"),
    after("直した方がいい、マジで"),
    after("学びがないんだよね"),
    after("…まあいいや"),
    after("これ普通にダメだからね"),
    // ロールを持ち出すのは、プレイそのものへの指摘のときだけ(連戦や時間帯の話には付けない)
    make("TOPなんだからさぁ、", { role: "TOP", topic: PLAY_TOPICS }),
    make("JGがそれじゃ勝てないって、", { role: "JUNGLE", topic: PLAY_TOPICS }),
    make("MIDでそれはダメでしょ、", { role: "MIDDLE", topic: PLAY_TOPICS }),
    make("ADCなんだから殴ってよ、", { role: "BOTTOM", topic: "lowdamage" }),
    make("サポートがそれやっちゃダメなんだよね、", { role: "UTILITY", topic: PLAY_TOPICS }),
    onAfter("feeder", "前出すぎなんだよね、マジで"),
    onAfter("grayscreen", "灰色の時間で1本アニメ見れるよ"),
    onAfter("lowcs", "ミニオンは逃げないんだから取ってよ"),
    onAfter("loselane", "序盤で負けたら、あとずっと苦しいんだよね"),
    onAfter("blind", "ワードワードワード、ワード置いて"),
    onAfter("nopink", "買わない理由がないんだよね、あれ"),
    onAfter("afk", "5対5のゲームって知ってる？"),
    onAfter("lowdamage", "後ろで見てるだけなら観客でいいんだよね"),
    onAfter("kdaplayer", "KDAだけ綺麗でも勝てないんだよね"),
    onAfter("coinflip", "毎試合ギャンブルするのやめてほしい"),
    onAfter("tourist", "触っただけで使えるとは言わないからね"),
    onAfter("losing", "負けるのには理由があるんだよね、ちゃんと"),
    onAfter("nomad", "全部やる人は、全部できない人なんだよね"),
    onAfter("noobjective", "オブジェクト取らないと勝てないゲームなんで"),
    onAfter("behind15", "レーン戦って知ってる？"),
    onAfter("earlydeath", "10分もたないのはレーン戦じゃないんだよね"),
    onAfter("deepdeath", "帰り道って概念ある？"),
    onAfter("solodeath", "勝てない勝負は受けなくていいんだよね"),
    onAfter("thrower", "リードってね、使うものなんだよね"),
    onAfter("tilt", "熱くなってるときのLoL、だいたい負ける"),
    onAfter("marathon", "連戦ロボットになってる"),
    onAfter("nightloss", "深夜のプレイ、別人なんだよね"),
    onAfter("ff", "勝つ気あります？ って話"),
    onAfter("pinger", "ピン打ってる暇あったらミニオン取って"),
    onAfter("slump", "いまの自分、前の自分に負けてるよ"),
    onAfter("sidegap", "マップ反対になっただけなんだけどね"),
    onAfter("latelose", "長い試合で迷子になるのやめてほしい"),
    onAfter("badchamp", "向いてない。そのチャンピオンは向いてない"),
  ],
  verdictHigh: [
    make("うん、普通にうまい"),
    make("ナイス、ホントにナイス"),
    after("文句ないでーす"),
    after("このまま行って。マジで"),
    after("久しぶりにまともな人を見たわ"),
  ],
  verdictLow: [
    make("厳しいって。これは厳しい", LOW),
    make("正直きつい。正直ね", LOW),
    make("うーん…うん"),
    after("はい、解散でーす", LOW),
    after("うーん…まあいいや"),
    after("伸びしろしかない。伸びしろしか", LOW),
    after("練習して。普通に練習して"),
    after("ここから上がるだけだから。たぶん", LOW),
  ],
  homework: [
    make("じゃあ宿題ね、"),
    make("これだけやって、これだけ、"),
    make("難しいこと言わないから、"),
    after("やればできるから。たぶん"),
    after("できるようになったらまた来て"),
    after("言ったからね、俺は"),
    after("難しいこと言ってないからね"),
    onAfter("tilt", "負けたら休む。それだけなんだよね"),
    onAfter("marathon", "やめどきを決めるのも実力なんで"),
    onAfter("nightloss", "寝た方がうまくなるからね、ホントに"),
    onAfter("pinger", "ピンは情報。気持ちを伝えるものじゃないんで"),
    onAfter("ff", "負けてる試合が一番練習になるんだよね"),
    onAfter("badchamp", "好きと得意は違うんだよね"),
  ],
  // 脱線は実際の発言だけにする(作った雑談は入れない)
  aside: [],
};
