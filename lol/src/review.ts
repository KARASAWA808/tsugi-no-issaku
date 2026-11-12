// 自己紹介のひとつひとつに、評価役(架空のキャラクター)が数字でツッコミを入れる。DOMには触れない。
// 辛口にするのはプレイの内容だけ。人格・容姿・属性には触れない文章だけを置く。
import type { Analysis, AxisKey, Grade, StrengthId, WeaknessId } from "./analyze";
import { type Intro, type Line, type TextOptions, type Topic, seedOf, valuesOf } from "./intro";
import { makeRng, pick } from "./labels";
import { emptyBook, makeSpeaker } from "./phrases";
import type { PlayerData } from "./types";

export interface Reply {
  topic: Topic;
  /** 強みとして認めたなら true、崩したなら false */
  accepted: boolean;
  text: string;
}

export interface Roast {
  topic: WeaknessId | AxisKey;
  text: string;
}

export interface Review {
  opening: string;
  /** intro.claims と同じ順番・同じ数 */
  replies: Reply[];
  /** 自己紹介で触れなかった弱み */
  roasts: Roast[];
  grade: Grade;
  /** ひとことで言うとどんなプレイヤーか */
  title: string;
  verdict: string;
  /** 次にやること。辛口でも、ここだけは具体的な助言にする */
  homework: string;
}

const ACKS: Record<StrengthId, readonly Line[]> = {
  kda: [
    (v) => `KDA${v.kda}は数字としては立派。そこは認める。`,
    (v) => `${v.k}/${v.d}/${v.a}ね。死なないのはいいこと。問題は、それで試合を動かせてるかどうか。`,
  ],
  cs: [
    (v) => `分間${v.cs}は取れてる。そこはちゃんとしてる。`,
    (v) => `CS分間${v.cs}は合格。やっと数字の話ができる。`,
  ],
  vision: [
    (v) => `視界スコア分間${v.vision}、これはえらい。地味だけど勝ちに直結するやつ。`,
    (v) => `コントロールワード1試合${v.pinks}本。ちゃんと買ってる人、意外と少ないんよ。`,
  ],
  teamfight: [
    (v) => `関与率${v.kp}%は高い。ちゃんと味方と同じゲームをしてる。`,
    (v) => `キルの${v.kp}%に絡んでるのは本当。寄りの判断はできてる。`,
  ],
  damage: [
    (v) => `ダメージ割合${v.dmg}%は出てる。キャリーを名乗っていい数字。`,
    (v) => `チームの${v.dmg}%を出してるのは事実。殴れる位置には立ててる。`,
  ],
  solokill: [
    (v) => `1試合${v.solo}回のソロキルは本物。対面はしんどいと思う。`,
    (v) => `ソロキル${v.solo}回、レーンの腕はある。あとはそのリードをどこに使うか。`,
  ],
  survive: [
    (v) => `30分で${v.d30}デス。死なないのは才能、そこは褒める。`,
    (v) => `${v.d30}デスは少ない。相手にゴールドを渡さないのは立派な仕事。`,
  ],
  objective: [
    (v) => `オブジェクトに1試合${v.obj}個。勝ち方を知ってる人の動き。`,
    () => `ドラゴンとバロンに寄れてるのはえらい。そこをサボる人が多いから。`,
  ],
  onetrick: [
    (v) => `${v.champ}で勝率${v.champWr}%、やり込んでるのは伝わる。BANされた瞬間に別人になるタイプだろうけど。`,
    (v) => `${v.champGames}試合${v.champ}。1体をやり込むのは正しい上達法。ただし${v.champ}が弱くなったら一緒に沈む。`,
  ],
  winrate: [
    (v) => `勝率${v.wr}%は文句なし。結局、勝ってる人がいちばん正しい。`,
    (v) => `${v.games}試合で${v.wr}%勝ってるなら、やってることは合ってる。`,
  ],
  firstblood: [
    (v) => `序盤から動けてるのはいい。関与率${v.fb}%は誇っていい。`,
    (v) => `ファーストブラッドに${v.fb}%絡んでる。試合の入りがうまい。`,
  ],
  pool: [(v) => `${v.pool}体使って勝ち越してるなら本物の器用さ。ふつうは器用貧乏で終わる。`],
  multikill: [
    (v) => `${v.multi}はおめでとう。で、それ何試合に1回の話?`,
    (v) => `${v.multi}は気持ちいいよね。ハイライトと実力は別の話だけど。`,
  ],
};

/** 強みを認めたあとに足す「ただし」。その強みと特定の弱みが両方あるときだけ */
const BUTS: readonly { strength: StrengthId; weakness: WeaknessId; line: Line }[] = [
  { strength: "kda", weakness: "kdaplayer", line: (v) => `ただ勝率${v.wr}%でしょ。勝負どころで下がって、KDAを守ってるだけに見える。` },
  { strength: "cs", weakness: "afk", line: (v) => `ただキル関与率${v.kp}%。ミニオンを数えてるあいだ、味方は4対5をやらされてる。` },
  { strength: "damage", weakness: "feeder", line: (v) => `でも30分で${v.d30}デス。出したダメージのぶん、きっちりゴールドを返してる。` },
  { strength: "solokill", weakness: "feeder", line: (v) => `ただ30分で${v.d30}デス。倒した数より、倒されて返した数を数えたほうがいい。` },
  { strength: "teamfight", weakness: "feeder", line: () => `ただ、いるだけで毎回先に落ちてる。関与と道連れは別。` },
  { strength: "firstblood", weakness: "feeder", line: () => `ただ、取ったリードを中盤までに全部配ってる。` },
  { strength: "survive", weakness: "afk", line: (v) => `でも関与率${v.kp}%。死なないのは、戦ってないからだよね。` },
  { strength: "survive", weakness: "lowdamage", line: (v) => `でもダメージ割合${v.dmg}%。安全な場所から見てるだけなら、そりゃ死なない。` },
  { strength: "kda", weakness: "lowdamage", line: (v) => `でもダメージ割合${v.dmg}%。アシストを拾ってるだけで、勝負は決めてない。` },
  { strength: "cs", weakness: "losing", line: (v) => `それで勝率${v.wr}%。ゴールドを持ってるのに使い道を知らない。` },
  { strength: "vision", weakness: "feeder", line: (v) => `それだけ見えてて30分で${v.d30}デスなのが謎。置いたワードを見てない。` },
];

const DEBUNKS: Record<WeaknessId | "spirit", readonly Line[]> = {
  feeder: [
    (v) => `「前で戦ってる」じゃないんよ。30分で${v.d30}回死ぬのは、戦ってるんじゃなくて配ってる。`,
    (v) => `いちばん死んだ試合、${v.worstChamp}で${v.worstD}デス。これはアグレッシブじゃなくて事故。`,
  ],
  grayscreen: [(v) => `試合時間の${v.dead}%が灰色。それは考える時間じゃなくて、味方が4人で耐えてる時間。`],
  lowcs: [
    (v) => `分間${v.cs}は、ミニオンもキルも見えてない数字。1ウェーブ落とすのは、キルを半分捨ててるのと同じ。`,
    (v) => `戦闘がスタイルの人でも分間${v.cs}にはならない。ゴールドがないから、その戦闘にも勝てない。`,
  ],
  loselane: [(v) => `10分で${v.cs10}CSは準備運動じゃなくて、もう負けてる。中盤が本番の人は、中盤に間に合う序盤をやってる。`],
  blind: [
    (v) => `勘で見えてたら1試合${v.d}回も死なない。視界スコア分間${v.vision}は、目を閉じて運転してるのと同じ。`,
    (v) => `視界に頼らない立ち回り、は存在しない。分間${v.vision}は「見てない」だけ。`,
  ],
  nopink: [(v) => `75ゴールドで買えるいちばん強いアイテムがコントロールワード。1試合${v.pinks}本は、買ってないのと同じ。`],
  afk: [
    (v) => `関与率${v.kp}%。サイドで圧をかけてるんじゃなくて、いないだけ。相手は5対4で気持ちよく勝ってる。`,
    (v) => `1人で押すのが戦術になるのは、相手が2人寄ってくるとき。関与率${v.kp}%は、無視されてる。`,
  ],
  lowdamage: [(v) => `数字に出ない貢献は、だいたい存在しない貢献。ダメージ割合${v.dmg}%は見学。`],
  kdaplayer: [(v) => `仕事をしてる人の勝率は${v.wr}%にならない。KDAは守るものじゃなくて、勝つために使うもの。`],
  coinflip: [(v) => `波があるのは才能じゃなくて、再現性がないってこと。${v.disaster}%の試合で事故る人に、味方は賭けたくない。`],
  tourist: [(v) => `${v.pool}体「使える」じゃなくて、${v.pool}体「触った」ね。勝率${v.wr}%がその答え。`],
  losing: [
    (v) => `${v.games}試合やって勝率${v.wr}%は、味方のせいにできる数じゃない。全試合にいた共通点は自分だけ。`,
    (v) => `本当の実力は、いま出てる数字のこと。勝率${v.wr}%、それが実力。`,
  ],
  nomad: [() => `全部できる人は、全部のロールでこの成績にならない。まだ何も決めてないだけ。`],
  noobjective: [(v) => `オブジェクト関与が1試合${v.obj}個。レーンを押してるあいだにドラゴンを4つ取られたら、押したタワーごと負ける。`],
  spirit: [
    () => `やる気は評価項目にない。`,
    () => `伸びしろがあるっていうのは、いま伸びてないってことだからね。`,
    () => `それはメンタルが強いんじゃなくて、反省してないだけ。`,
  ],
};

const ROASTS: Record<WeaknessId, readonly Line[]> = {
  feeder: [
    (v) => `デスが30分あたり${v.d30}回。相手のキャリーをいちばん育ててるのは${v.name}さん。`,
    (v) => `${v.worstChamp}で${v.worstD}デスの試合、あれは何があった。平均でも30分に${v.d30}回は多すぎる。`,
  ],
  grayscreen: [(v) => `試合の${v.dead}%は灰色の画面。観戦しに来たのかな。`],
  lowcs: [(v) => `CSが分間${v.cs}。ゴールドがないから弱い、弱いから死ぬ。その入口がここ。`],
  loselane: [(v) => `10分時点で${v.cs10}CS。レーン戦でついた差を、残りの20分ずっと払い続けてる。`],
  blind: [(v) => `視界スコアが分間${v.vision}。ガンクに毎回驚いてると思うけど、見てないものは見えない。`],
  nopink: [(v) => `コントロールワードが1試合${v.pinks}本。ショップでいちばん安い勝ち筋を、毎回見送ってる。`],
  afk: [(v) => `キル関与率${v.kp}%。味方から見ると、ミニマップにたまに映る人。`],
  lowdamage: [(v) => `ダメージ割合${v.dmg}%。${v.role}でこの数字は、戦闘中に何を押してたのか聞きたい。`],
  kdaplayer: [(v) => `KDA${v.kda}で勝率${v.wr}%。きれいな戦績で負ける名人。`],
  coinflip: [(v) => `${v.disaster}%の試合で大事故。勝つときは派手、負けるときはもっと派手。`],
  tourist: [(v) => `${v.games}試合で${v.pool}体。チャンピオンを覚える前に次へ行ってる。`],
  losing: [(v) => `勝率${v.wr}%、最長${v.streak}連敗。負けが込んでるのにキューを押し続けるのは、根性じゃなくて判断ミス。`],
  nomad: [() => `メインロールが決まってない。どのロールの反省も、半分ずつしか積めてない。`],
  noobjective: [(v) => `オブジェクト関与が1試合${v.obj}個。ドラゴンは味方が勝手に取ってくれるものだと思ってる。`],
};

const HOMEWORK: Record<WeaknessId, Line> = {
  feeder: () => `次の10試合、目標は勝ちじゃなくて「5デス以内」。前に出る前に、相手ジャングラーがミニマップに映ってるかだけ確認して。`,
  grayscreen: () => `死んだら、リスポーンまでに「なぜ死んだか」を一言で言う。言えない死が減れば、灰色の時間も減る。`,
  lowcs: () => `練習ツールで、10分のラストヒット練習を1日1回。試合では「10分で60CS」を最低ラインにして。`,
  loselane: (v) => `序盤の10分はキルを狙わなくていい。「10分で${v.cs10Goal}CS」だけを目標に3試合やってみて。`,
  blind: () => `リコールのたびにコントロールワードを1本買う。トリンケットは溜めずに使う。まずはこの2つだけ。`,
  nopink: () => `リコールのたびにコントロールワードを1本。インベントリに常に1本ある状態を当たり前にして。`,
  afk: () => `ドラゴンとバロンが湧く1分前に、自分のレーンを押してから寄る。これを毎回やるだけで関与率は上がる。`,
  lowdamage: () => `集団戦のリプレイを1本だけ見て、スキルを撃ってない時間を数えて。一歩前に立てる場面がかならずある。`,
  kdaplayer: () => `リードしてる試合では、オブジェクトの前で自分から仕掛ける役をやって。KDAは貯めるものじゃなくて使うもの。`,
  coinflip: () => `負けてる試合でこそ、無理な仕掛けをやめる。「連続で死なない」を10試合。`,
  tourist: () => `チャンピオンを2体に絞って20試合。話はそれから。`,
  losing: () => `2連敗したら、その日は終わり。それと、ロールとチャンピオンを固定して。`,
  nomad: () => `ロールを1つ決めて30試合。決めないと反省が積み上がらない。`,
  noobjective: () => `ドラゴンが湧く時間を毎回確認する。湧く前に視界を置いて、湧いたら寄る。それだけ。`,
};

const TITLES: Record<WeaknessId, string> = {
  feeder: "歩く300ゴールド",
  grayscreen: "灰色画面の常連",
  lowcs: "ミニオン見逃し名人",
  loselane: "10分で負けてる人",
  blind: "暗闇の住人",
  nopink: "75ゴールドを惜しむ人",
  afk: "ミニマップにたまに映る人",
  lowdamage: "戦場の見学者",
  kdaplayer: "KDAの番人",
  coinflip: "人間コイントス",
  tourist: "チャンピオン観光客",
  losing: "キューを押す手が止まらない人",
  nomad: "ロールの旅人",
  noobjective: "ドラゴンに会ったことがない人",
};

const CLEAN_TITLES: Record<Grade, string> = {
  S: "言うだけのことはある人",
  A: "口だけではなかった人",
  B: "ふつうにうまい人",
  C: "ふつうの人",
  D: "これからの人",
};

const VERDICTS: Record<Grade, readonly Line[]> = {
  S: [
    (v) => `総合${v.overall}点、S。……悔しいけど、言うだけのことはある。このまま続けて。`,
    (v) => `総合${v.overall}点でS。辛口のつもりで見たのに、刺すところがほとんどない。`,
  ],
  A: [
    (v) => `総合${v.overall}点、A。うまい。でも「うまい」で止まってる。上で言ったところを直せば、もう一段ある。`,
    (v) => `総合${v.overall}点でA。自己紹介はだいたい本当だった。だいたい、ね。`,
  ],
  B: [
    (v) => `総合${v.overall}点、B。ふつう。自己紹介の勢いほどは強くない。`,
    (v) => `総合${v.overall}点でB。悪くはない。ただ、あの自己紹介をするならAは取ってきて。`,
  ],
  C: [
    (v) => `総合${v.overall}点、C。自己紹介は立派だったけど、中身が追いついてない。`,
    (v) => `総合${v.overall}点でC。口はダイヤ、プレイはこれから。`,
  ],
  D: [
    (v) => `総合${v.overall}点、D。自己紹介の前に、まず練習ツールを開こう。`,
    (v) => `総合${v.overall}点でD。いまのところ、強いのは自己紹介だけ。`,
  ],
};

const OPENINGS: readonly Line[] = [
  (v) => `${v.name}さんね。直近${v.games}試合、全部見ました。先に言っておくと、数字は嘘をつかないんで。`,
  (v) => `はい、${v.name}さん。${v.rank}の${v.role}。直近${v.games}試合の数字で話すね。`,
  (v) => `${v.name}さん、自己紹介ありがとう。じゃあ直近${v.games}試合と答え合わせしようか。`,
];

/** 「触れなかった弱み」として挙げる数の上限 */
const ROAST_LIMIT = 3;

export function buildReview(player: PlayerData, analysis: Analysis, intro: Intro, options: TextOptions = {}): Review {
  // 自己紹介と同じ種だと同じ番号の文を引きやすいので、ずらしておく
  const rng = makeRng(seedOf(player, options.variant) ^ 0x5bd1e995);
  const v = valuesOf(player, analysis, options.champName ?? ((id) => id));
  // 口ぐせは別の乱数で選ぶ。口ぐせを足しても、元の評価文の選ばれ方は変わらない
  const say = makeSpeaker(options.phrases ?? emptyBook(), makeRng(seedOf(player, options.variant) ^ 0x2c1b3c6d), player.gameName);
  const weak = new Set(analysis.weaknesses.map((w) => w.id));
  const mentioned = new Set<WeaknessId>();

  const replies: Reply[] = intro.claims.map((claim) => {
    if (!claim.backed) {
      const topic = claim.topic as WeaknessId | "spirit";
      if (topic !== "spirit") mentioned.add(topic);
      return { topic: claim.topic, accepted: false, text: say("reject", pick(DEBUNKS[topic], rng)(v)) };
    }
    const topic = claim.topic as StrengthId;
    const but = BUTS.find((b) => b.strength === topic && weak.has(b.weakness) && !mentioned.has(b.weakness));
    if (but) mentioned.add(but.weakness);
    const ack = pick(ACKS[topic], rng)(v);
    return { topic, accepted: true, text: say("accept", but ? `${ack}${but.line(v)}` : ack) };
  });

  const roasts: Roast[] = analysis.weaknesses
    .filter((w) => !mentioned.has(w.id))
    .slice(0, ROAST_LIMIT)
    .map((w) => ({ topic: w.id, text: say("roast", pick(ROASTS[w.id], rng)(v)) }));
  // 弱みがひとつも出ていない人にも、いちばん低い軸をひとつだけ指摘する
  if (analysis.weaknesses.length === 0) {
    const lowest = analysis.axes.reduce((low, a) => (a.score < low.score ? a : low));
    roasts.push({
      topic: lowest.key,
      text: say("roast", `強いて言うなら、${lowest.label}が${lowest.score}点でいちばん低い。伸ばすならここ。`),
    });
  }

  const worst = analysis.weaknesses[0];
  const few = analysis.games < 8 ? `ただ${v.games}試合しかないから、話半分で聞いて。` : "";
  const high = analysis.grade === "S" || analysis.grade === "A";
  return {
    opening: say("opening", `${pick(OPENINGS, rng)(v)}${few}`),
    replies,
    roasts,
    grade: analysis.grade,
    title: worst ? TITLES[worst.id] : CLEAN_TITLES[analysis.grade],
    verdict: say(high ? "verdictHigh" : "verdictLow", pick(VERDICTS[analysis.grade], rng)(v)),
    homework: say(
      "homework",
      worst ? HOMEWORK[worst.id](v) : `正直、課題らしい課題がない。同じことをランクを1つ上げてもやれるか、それだけ見せて。`,
    ),
  };
}
