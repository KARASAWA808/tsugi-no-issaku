// 組み立てに変化をつけるための小さな表。つなぎの言葉、称号の枕ことば、「ところで」のひとこと。
// 文はすべて values.ts の Values から数字を差し込む。罵倒語や実在の人の名前は入れない(口ぐせは別の表が足す)。
import type { Analysis, StrengthId, WeaknessId } from "../analyze";
import { winRateOf } from "../detail";
import type { Line } from "./values";

/** 自己紹介の2つ目・3つ目の前に置く、つなぎの言葉。空文字は「つなぎなし」 */
export const CONNECTORS: readonly string[] = [
  "", "", "", "それと、", "あと、", "ちなみに、", "さらに言うと、", "それから、", "付け加えると、", "もうひとつ。", "あと言っておきたいのが、", "これも聞いてください。",
];

/** 称号の前に付ける枕ことば。言い直したときに、半分くらいの確率で付く */
export const TITLE_PREFIXES: readonly string[] = [
  "筋金入りの", "自称・", "安定の", "生粋の", "折り紙つきの", "年季の入った", "まぎれもない", "期待を裏切らない", "今日も元気な", "誰もが認める",
  "天然ものの", "ゆるぎない", "正真正銘の", "おなじみの",
];

type Has = (id: StrengthId | WeaknessId) => boolean;

export interface Note {
  /** この数字に触れてよい条件。強み・弱みとしてもう話に出ているものは、ここでは繰り返さない */
  when: (a: Analysis, has: Has) => boolean;
  lines: readonly Line[];
}

/**
 * 「ところで」のひとこと。強みや弱みと言うほどではないが、目に付いた数字に評価役が触れる。
 * 条件に合うものの中から1つ選ぶ。最後の3つは誰にでも当てはまる。
 */
export const NOTES: readonly Note[] = [
  {
    // サイドで勝率に差がある(弱みと言うほどの差ではない)
    when: (a, has) => !has("sidegap") && a.detail.side.blue.games >= 4 && a.detail.side.red.games >= 4 && Math.abs(winRateOf(a.detail.side.blue) - winRateOf(a.detail.side.red)) >= 0.2,
    lines: [
      (v) => `ところで、青側の勝率が${v.blueWr}%で、赤側が${v.redWr}%。サイドが変わるだけで、ここまで変わるのは気にしたほうがいい。`,
      (v) => `ところで、青側${v.blueWr}%、赤側${v.redWr}%。カメラの向きに左右される人は、ワードを置く場所をサイドごとに決めてない。`,
      (v) => `あと細かい話。青側と赤側で勝率が${v.blueWr}%と${v.redWr}%。苦手なほうのリプレイを1本見るだけで、だいぶ変わる。`,
    ],
  },
  {
    when: (a, has) => !has("marathon") && a.detail.longestSession >= 3,
    lines: [
      (v) => `ところで、最長${v.session}連戦してるね。何試合目から集中が切れるか、自分で分かってる?`,
      (v) => `ところで、休みなしで${v.session}試合。勝ってるうちはいいけど、負けはじめたらそこが引きどき。`,
      (v) => `ちなみに最長${v.session}連戦。最後の試合の内容を覚えてないなら、その試合はやらなくてよかった試合。`,
    ],
  },
  {
    when: (a) => a.avg.durationMin >= 32,
    lines: [
      (v) => `ところで、1試合が平均${v.avgMin}分。長い。勝ってる試合を終わらせるのに時間がかかってるか、負けてる試合が粘ってるか、どっちか。`,
      (v) => `ちなみに平均${v.avgMin}分。試合が長引く人は、取るべきタイミングでバロンを取ってないことが多い。`,
    ],
  },
  {
    when: (a) => a.avg.durationMin <= 26,
    lines: [
      (v) => `ところで、1試合が平均${v.avgMin}分。短い。早く決まる試合が多いのは、序盤で勝負がついてるってこと。良くも悪くも。`,
      (v) => `ちなみに平均${v.avgMin}分。終盤の経験が少ないはずだから、たまに長引いた試合のリプレイは貴重。`,
    ],
  },
  {
    when: (a, has) => !has("pinger") && a.detail.pings >= 45,
    lines: [
      (v) => `ところで、ピンが1試合${v.pingAll}回。情報を出すのはいいこと。味方が見てるかは別だけど。`,
      (v) => `ちなみにピンは1試合${v.pingAll}回。出すほうに忙しくて、自分のミニマップを見る時間が減ってない?`,
    ],
  },
  {
    when: (a, has) => !has("dodger") && a.detail.dodged >= 40,
    lines: [
      (v) => `ところで、スキルを1試合${v.dodged}発避けてる。手は動いてる。あとは頭。`,
      (v) => `ちなみに1試合${v.dodged}発の回避。操作の問題じゃないのは、この数字で分かる。`,
    ],
  },
  {
    when: (a) => a.detail.dodged > 0 && a.detail.dodged <= 30,
    lines: [
      (v) => `ところで、避けたスキルが1試合${v.dodged}発。少ない。横に歩くだけで避けられるものを、だいぶもらってる。`,
      (v) => `ちなみに回避は1試合${v.dodged}発。レーンで真っすぐ立ってる時間が長い。`,
    ],
  },
  {
    when: (a, has) => !has("coinflip") && !has("kda") && a.games >= 8 && a.disasterRate < 0.3,
    lines: [
      (v) => `ところで、KDAが5を超えた試合は${v.greatPct}%。良い日の自分を、ふだんの自分だと思わないこと。`,
      (v) => `ちなみに大当たりの試合は${v.greatPct}%。残りの試合で何をしてるかが、ランクを決めてる。`,
    ],
  },
  {
    when: (a) => a.detail.afterWin.games >= 3,
    lines: [
      (v) => `ところで、勝った直後に始めた試合の勝率が${v.afterWinWr}%。勝ったあとの自分がどうなるか、知っておいて損はない。`,
      (v) => `ちなみに勝った直後の試合は勝率${v.afterWinWr}%。勢いで押してるのか、流れに乗れてるのか、数字はこう言ってる。`,
    ],
  },
  {
    when: (a, has) => !has("nightloss") && a.detail.time.night.games >= 3,
    lines: [
      (v) => `ところで、深夜に${v.nightGames}試合やってて勝率${v.nightWr}%。それ以外の時間は${v.dayWr}%。比べてみて。`,
      (v) => `ちなみに0時を過ぎてからの${v.nightGames}試合は勝率${v.nightWr}%。昼間は${v.dayWr}%。寝る時間の参考に。`,
    ],
  },
  {
    when: (a, has) => !has("nomad") && a.mainRole !== "UNKNOWN" && a.roleShare < 0.9,
    lines: [
      (v) => `ところで、${v.role}は全体の${v.rolePct}%。残りはほかのロール。オートフィルなら仕方ないけど、自分で選んでるなら絞ったほうが早い。`,
      (v) => `ちなみに${v.role}で出たのは${v.rolePct}%の試合。ほかのロールの試合が、平均を少しずつ下げてる。`,
    ],
  },
  {
    when: (a, has) => !has("tourist") && !has("pool") && a.champions.length >= 4,
    lines: [
      (v) => `ところで、${v.games}試合で${v.pool}体使ってる。多くはないけど少なくもない。勝ってるのはどれか、自分で把握してる?`,
      (v) => `ちなみにチャンピオンは${v.pool}体。いちばん使う${v.champ}が${v.champGames}試合。残りに本当に必要なものが何体あるか。`,
    ],
  },
  {
    when: (a, has) => !has("onetrick") && a.champions.length === 1,
    lines: [
      (v) => `ところで、${v.games}試合ぜんぶ${v.champ}。一途なのはいい。BANされた日の予定も立てておいて。`,
      (v) => `ちなみに${v.champ}しか使ってない。その1体で勝率${v.champWr}%。数字が良いうちは、それでいい。`,
    ],
  },
  {
    when: (a, has) => !has("ff") && a.detail.surrenders >= 1,
    lines: [
      (v) => `ところで、降参で終わった負けが${v.ffCount}試合。負けのうち${v.ffPct}%。そこでしか練習できないことを、そのぶん飛ばしてる。`,
      (v) => `ちなみに降参は${v.ffCount}回。多くはない。ただ、降参しなかった試合で何回ひっくり返したかも数えてみて。`,
    ],
  },
  {
    when: (a, has) => !has("onetrick") && !has("badchamp") && a.champions[0].games >= 5 && a.games - a.champions[0].games >= 5,
    lines: [
      (v) => `ところで、${v.champ}の勝率が${v.champWr}%で、それ以外が${v.otherWr}%。どっちを出すべきかは、数字がもう答えてる。`,
      (v) => `ちなみに${v.champ}だと${v.champWr}%、ほかのチャンピオンだと${v.otherWr}%。この差を知ったうえでピックしてる?`,
    ],
  },
  {
    when: (a, has) => !has("form") && !has("slump") && a.games >= 10,
    lines: [
      (v) => `ところで、直近5試合は${v.recentW}勝${v.recentL}敗。その前の勝率は${v.earlierWr}%。良くも悪くも、いつもどおり。`,
      (v) => `ちなみに直近5試合が${v.recentW}勝${v.recentL}敗で、その前が${v.earlierWr}%。大きくは変わってない。変えたいなら、何かを変えないと。`,
    ],
  },
  {
    when: (a, has) => !has("noobjective") && !has("objective") && a.detail.objectiveShare > 0,
    lines: [
      (v) => `ところで、味方が取ったドラゴンやバロンのうち、絡んだのは${v.objShare}%。残りは、いなくても取れたぶん。`,
      (v) => `ちなみにオブジェクトへの関与は${v.objShare}%。数字としては普通。普通を抜けたいなら、ここは上げやすい。`,
    ],
  },
  // --- ここから下は、誰にでも当てはまる ---
  {
    when: () => true,
    lines: [
      (v) => `ところで、平均すると${v.k}/${v.d}/${v.a}。この3つのうち、いちばん自分で変えやすいのは真ん中の数字。`,
      (v) => `ちなみに${v.games}試合で${v.wins}勝${v.losses}敗。勝ち負けより、負けた${v.losses}試合に同じ負け方がいくつあるかを見て。`,
      (v) => `ところで、いちばん使ってるのは${v.champ}で${v.champGames}試合、勝率${v.champWr}%。この数字が、いまの実力にいちばん近い。`,
    ],
  },
];
