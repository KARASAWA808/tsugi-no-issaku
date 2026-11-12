// 評価役の「口ぐせ」を、組み立てた評価文の前後に差し込む。DOMには触れない。
// 口ぐせは2か所から集める:
//   1. この下の BUILTIN_PHRASES(出典を確かめられたものだけを、出典つきで置く)
//   2. 手元にだけ置く lol/public/local/phrases.json(git 管理外。自分で聞いたことのある言い回しを足す場所)
// 評価の中身(数字へのツッコミ)は自動で組み立てたもので、ご本人の発言ではない。口ぐせは言い回しを借りているだけ。
import type { Grade, StrengthId, WeaknessId } from "./analyze";
import type { Role } from "./types";

/** 口ぐせを合わせる「話題」。自己紹介や指摘が何の話か(analyze の強み・弱みと同じ名前) */
export type PhraseTopic = StrengthId | WeaknessId | "spirit";

/** 口ぐせを入れる場所 */
export type Slot =
  /** 評価の最初のひとこと */
  | "opening"
  /** 自己紹介を「認める」とき */
  | "accept"
  /** 自己紹介を「却下」するとき */
  | "reject"
  /** 自己紹介になかった弱みを指摘するとき */
  | "roast"
  /** 総評(S・A のとき) */
  | "verdictHigh"
  /** 総評(B・C・D のとき) */
  | "verdictLow"
  /** 次の宿題を出すとき */
  | "homework";

export const SLOTS: readonly Slot[] = ["opening", "accept", "reject", "roast", "verdictHigh", "verdictLow", "homework"];

export interface Phrase {
  /** 言い回し。`{name}` はプレイヤー名に置きかわる */
  text: string;
  /** true なら評価文のあとに付ける。なければ前に付ける */
  after?: boolean;
  /** 書くと、メインロールがこれの人にだけ使う(「TOPレーナーとして…」のようなロール限定の言い回し用) */
  role?: Role;
  /** 書くと、その話題の評価文にだけ使う(「ファームが下手」はCSの指摘にだけ、など) */
  topic?: PhraseTopic;
  /** 書くと、総合評価がこのどれかの人にだけ使う(きつい言い回しを高評価の人に出さない、など) */
  grades?: readonly Grade[];
  /** どこで確かめた言い回しか(画面には出さない覚え書き) */
  source?: string;
  /** true なら、実際の発言ではなく「言いそうな台詞」として作ったもの。実際の発言より出にくくする */
  imagined?: boolean;
}

export type PhraseBook = Record<Slot, Phrase[]>;

export const emptyBook = (): PhraseBook => ({
  opening: [], accept: [], reject: [], roast: [], verdictHigh: [], verdictLow: [], homework: [],
});

/** 1つの言い回しの長さと、1つの場所に置ける数の上限(手元のファイルが壊れていても画面が崩れないように) */
const MAX_LENGTH = 80;
const MAX_PER_SLOT = 200;
const MAX_SOURCE_LENGTH = 200;
const ROLES: readonly string[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
const GRADES: readonly string[] = ["S", "A", "B", "C", "D"];
// 型で数えもれを防ぐため、話題の名前はオブジェクトのキーで持つ
const TOPIC_NAMES: Record<PhraseTopic, true> = {
  kda: true, cs: true, vision: true, teamfight: true, damage: true, solokill: true, survive: true,
  objective: true, onetrick: true, winrate: true, firstblood: true, pool: true, multikill: true,
  feeder: true, grayscreen: true, lowcs: true, loselane: true, blind: true, nopink: true, afk: true, lowdamage: true,
  kdaplayer: true, coinflip: true, tourist: true, losing: true, nomad: true, noobjective: true,
  lanewin: true, comeback: true, lategame: true, plates: true, healer: true, cc: true, dodger: true, form: true, steal: true,
  behind15: true, earlydeath: true, deepdeath: true, solodeath: true, thrower: true, tilt: true, marathon: true,
  nightloss: true, ff: true, pinger: true, slump: true, sidegap: true, latelose: true, badchamp: true,
  spirit: true,
};
export const PHRASE_TOPICS = Object.keys(TOPIC_NAMES) as PhraseTopic[];

function parsePhrase(item: unknown): Phrase | null {
  const raw = typeof item === "string" ? { text: item } : item;
  if (typeof raw !== "object" || raw === null) return null;
  const { text, after, role, topic, grades, source, imagined } = raw as Record<string, unknown>;
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > MAX_LENGTH) return null;
  const phrase: Phrase = { text: trimmed };
  if (after === true) phrase.after = true;
  if (role !== undefined) {
    // ロールの書きまちがいは、全員に出てしまわないよう捨てる
    if (typeof role !== "string" || !ROLES.includes(role)) return null;
    phrase.role = role as Role;
  }
  if (topic !== undefined) {
    if (typeof topic !== "string" || !Object.hasOwn(TOPIC_NAMES, topic)) return null;
    phrase.topic = topic as PhraseTopic;
  }
  if (grades !== undefined) {
    // 評価の書きまちがいも、だれにでも出てしまわないよう捨てる
    if (!Array.isArray(grades) || grades.length === 0 || !grades.every((g) => typeof g === "string" && GRADES.includes(g))) return null;
    phrase.grades = grades as Grade[];
  }
  if (typeof source === "string" && source.trim() !== "") phrase.source = source.trim().slice(0, MAX_SOURCE_LENGTH);
  if (imagined === true) phrase.imagined = true;
  return phrase;
}

/**
 * phrases.json の中身を PhraseBook にする。形の合わないところは黙って捨てる。
 * 各場所は、文字列か `{ "text": "...", "after": true, "role": "TOP", "topic": "lowcs", "grades": ["C", "D"] }` の配列。
 */
export function parsePhrases(input: unknown): PhraseBook {
  const book = emptyBook();
  if (typeof input !== "object" || input === null) return book;
  for (const slot of SLOTS) {
    const list = (input as Record<string, unknown>)[slot];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const phrase = parsePhrase(item);
      if (phrase && book[slot].length < MAX_PER_SLOT) book[slot].push(phrase);
    }
  }
  return book;
}

/** 複数の PhraseBook を合わせる。同じ場所の同じ言い回しは1つにする */
export function mergePhrases(...books: readonly PhraseBook[]): PhraseBook {
  const merged = emptyBook();
  for (const slot of SLOTS) {
    const seen = new Set<string>();
    for (const book of books) {
      for (const phrase of book[slot]) {
        if (seen.has(phrase.text)) continue;
        seen.add(phrase.text);
        merged[slot].push(phrase);
      }
    }
  }
  return merged;
}

export const countPhrases = (book: PhraseBook): number => SLOTS.reduce((total, slot) => total + book[slot].length, 0);

// 文として閉じている終わり方。そのまま次の文を続けてよい
const CLOSED = /[。、,!?\uFF01\uFF1F)\uFF09」』]$/;
// 伸ばしや笑いで終わる言い回し。句点は足さず、前に付けるときだけ1字あける
const TRAILING = /[.…~\uFF5E〜ー♪♡wｗ・]$/;

/**
 * 評価文に口ぐせを付ける関数を作る(1回の評価につき1つ作る)。
 * 多く使うほどそれらしくなるので、口ぐせがある場所では毎回付ける。
 * ただし同じ言い回しは1回の評価で1度だけ。使い切った場所には何も付けない(同じ台詞が並ぶと嘘くさくなる)。
 * 選ぶ順番は、話題の合うもの → ロール限定のもの → どこでも使えるもの。
 */
export function makeSpeaker(
  book: PhraseBook,
  rng: () => number,
  name: string,
  role: Role = "UNKNOWN",
  grade?: Grade,
): (slot: Slot, line: string, topic?: PhraseTopic) => string {
  const used = new Set<string>();

  return (slot, line, topic) => {
    // 別の場所でもう使った言い回しも、ここでは使わない
    const fresh = book[slot].filter(
      (p) =>
        (p.role === undefined || p.role === role) &&
        (p.topic === undefined || p.topic === topic) &&
        (p.grades === undefined || (grade !== undefined && p.grades.includes(grade))) &&
        !used.has(p.text),
    );
    if (fresh.length === 0) return line;
    // 出番の少ないものから先に使う
    const onTopic = fresh.filter((p) => p.topic !== undefined);
    const limited = fresh.filter((p) => p.role !== undefined);
    // 話題に合うのが作った台詞だけのときは、2回に1回は見送って、実際の発言(話題を選ばないもの)に出番を残す
    const general = limited.length > 0 ? limited : fresh.filter((p) => p.topic === undefined);
    const onlyImagined = onTopic.length > 0 && onTopic.every((p) => p.imagined);
    const skipTopic = onlyImagined && general.some((p) => !p.imagined) && rng() < 0.5;
    const pool = onTopic.length > 0 && !skipTopic ? onTopic : general.length > 0 ? general : fresh;
    // 作った台詞は、実際の発言の半分の出やすさにする(実際の発言があるうちは、そちらが主役)
    const weightOf = (p: Phrase): number => (p.imagined ? 0.5 : 1);
    let roll = rng() * pool.reduce((total, p) => total + weightOf(p), 0);
    let at = 0;
    while (at < pool.length - 1 && roll >= weightOf(pool[at])) {
      roll -= weightOf(pool[at]);
      at += 1;
    }
    const phrase = pool[at];
    used.add(phrase.text);
    const text = phrase.text.replaceAll("{name}", name);
    if (phrase.after) return `${line}${CLOSED.test(text) || TRAILING.test(text) ? text : `${text}。`}`;
    return `${text}${CLOSED.test(text) ? "" : TRAILING.test(text) ? " " : "。"}${line}`;
  };
}

/**
 * コードに入れておく口ぐせ。出典を確かめられたものだけを置き、出典を source に書く。
 * 確かめられないものは入れない(言っていないことを「言った」ことにしないため)。
 *
 * ほとんどは、視聴者がまとめたスプレッドシート「らいさまちくちく集」(発言とクリップへのリンクの一覧。2026年11月に全件を読んだ)から選んだ。
 *   https://docs.google.com/spreadsheets/d/1txzsWYmA86n7yrMtovgvI1arzblxUIG0DFLLcNi4lnU
 * 表記はシートのとおり(q = ちくちく集、k = 同じシートの「かわいい集」。数字はシートの No.)。
 * クリップそのものは見ていないので、聞き取りの正しさはシートを作った人たちに頼っている。
 *
 * 選ぶときの決まり(遊ぶ本人が望んだ辛口なので、「バカ」「カス」「雑魚」のような暴言はそのまま入れる):
 *   - ほかの実在の人の名前は入れない。名指しの発言は、名前を {name}(遊んでいる本人)に置きかえるか、名前のところを省いて入れる。
 *     置きかえ・省略・抜粋をしたものは source にそう書く(x = 加工したもの)
 *   - 死や暴力を願う言葉(「しね」「ぶん殴る」など)は入れない
 *   - 容姿・体型・性別に触れるものは入れない(成績しか見ていないので当てはめようがなく、ただの中傷になる)
 *   - 揉め事に由来する発言、ほかの人の発言は入れない
 */
const SHEET = "らいさまちくちく集";
type Extra = Omit<Phrase, "text" | "source">;
/** きつい言い回し。評価が C・D の人にだけ */
const LOW: Extra = { grades: ["C", "D"] };
/** 皮肉まじりの言い回し。S・A の人には出さない */
const NOT_HIGH: Extra = { grades: ["B", "C", "D"] };
const q = (no: number, text: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET} No.${no}` });
const k = (no: number, text: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET}(かわいい集)No.${no}` });
/** 加工して入れたもの。how に、何をしたか(名前を置きかえ・名前を省略・抜粋)を書く */
const x = (no: number, text: string, how: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET} No.${no}(${how})` });
const kx = (no: number, text: string, how: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET}(かわいい集)No.${no}(${how})` });
const RENAMED = "名前を置きかえ";
const UNNAMED = "名前を省略";
const EXCERPT = "抜粋";
const AFTER: Extra = { after: true };

// LTK スクリムのフィードバック。記事の題に出ている文言。トップの人にだけ、却下・追加の指摘・総評のどこかで1度だけ出す
const TOP_LANER: Phrase = {
  text: "TOPレーナーとしてどうかと思う。",
  after: true,
  role: "TOP",
  source: "https://fistbump-news.jp/article/2025/06/20/1181.html(記事の題)",
};

export const BUILTIN_PHRASES: PhraseBook = {
  opening: [
    q(174, "あ～こういう感じか"),
    q(278, "キミは一体…なんだね？"),
    q(584, "うわすんごいの来たな...マジ？"),
    q(295, "あ？お前を待ってたんだが？"),
    q(31, "お前起きてろよ、今から行くぞ"),
    q(34, "ねえねえねえ...まあいいや"),
    q(305, "アホが来た", LOW),
    q(600, "久しぶりに見たな頭おかしくなってるやつ", LOW),
    q(402, "ｯﾁ、ｸｯｿ...クソだりぃマジで...", LOW),
  ],
  accept: [
    k(51, "えらいえらい"),
    k(276, "お～よしよしよし～よく頑張ったね～～"),
    k(156, "ｸﾞｯｼﾞｮﾌﾞｸﾞｯｼﾞｮﾌﾞ！ｸﾞｯｼﾞｮﾌﾞ~"),
    k(305, "賢いでちゅね～～"),
    q(228, "そこそこそこ、それでいいよ…え？"),
    q(175, "喜びの涙を流せ"),
    k(244, "ファームおいちい、ファームおいちおいち", { topic: "cs" }),
    k(275, "ビジョン取りおくんです", { topic: "vision" }),
    k(238, "おおおぉお！よく出た！ｗ", { topic: "multikill" }),
    q(490, "昨日より味方強いな、敵が弱いのか？", { topic: "winrate" }),
    q(738, "なんだろうな、勝とうとしてるからじゃないか？", { ...AFTER, topic: "winrate" }),
    q(312, "マジで相手がゴミ過ぎて俺が相対的にクソ強いっていう", { ...AFTER, topic: "winrate" }),
    kx(299, "{name}、俺は勝ったら褒めるよ？", RENAMED, { topic: "winrate" }),
    kx(241, "{name}！！{name}！！やれるやん！", RENAMED),
    x(627, "実際そう", "相手の台詞を省略"),
    x(565, "俺の下位互換だ", UNNAMED, AFTER),
    q(726, "信じられん下手くそだなと思ったらベイトだった", NOT_HIGH),
    {
      text: "最も替えたくなかったのがサポートだった。",
      role: "UTILITY",
      source: "https://fistbump-news.jp/article/2025/07/30/1378.html(記事の題)",
    },
  ],
  reject: [
    q(675, "おい、話聞いてんのか"),
    q(428, "お前の言ってる話は何も入ってこなかった"),
    q(103, "中身のねぇ自己紹介チャンネルかよ"),
    q(309, "てきとうな事ばっか言いやがって"),
    q(196, "何言ってんだコイツ"),
    q(22, "意味わからんマジで"),
    q(629, "意味不明なこと言ってんじゃねえよ"),
    q(347, "今のは無いなぁ、マジで"),
    q(182, "ん～コレはね、罪です"),
    q(385, "はいじゃなくて。認識して"),
    q(44, "同じこともう一回言うの好きじゃないんだよね"),
    q(239, "そんな上手くないよ大丈夫"),
    q(728, "え？下手。"),
    q(704, "あ～もう下手だねぇ～"),
    q(809, "下手だな"),
    q(493, "激浅"),
    q(807, "思考が弱い"),
    q(247, "いや違う、どういう…まあいいや"),
    q(242, "吠えてる場合じゃないよ"),
    q(723, "何頑張ってるの？"),
    q(793, "なんなんだお前"),
    q(421, "おい"),
    q(360, "ホントにダメ！"),
    q(154, "なんで俺に逆らってくるのかわからないんだけど"),
    q(107, "まあ1個だけ言っておくと、口の利き方には気をつけろよ。お前らマジで"),
    q(708, "わかるよ～～わかるわかる。いやわかるよ？こういうやつ狩ってレート上げてきたんだもん"),
    q(18, "こいつバカ"),
    q(292, "バカ？"),
    q(434, "バカなんじゃないの"),
    q(722, "めっちゃバカだな"),
    q(754, "BAKAなのかなって思いながら見てた"),
    q(537, "うんBAKAだった"),
    q(100, "馬鹿が。雑魚がよ。逆らうんじゃねぇぞ"),
    q(339, "バカが。反撃されないとでも思うなよ"),
    q(669, "ボケナスすぎる～"),
    q(165, "下手くそに合わせろって事でしょ？"),
    q(581, "へたくそ！"),
    q(220, "お前は一体何を言っている？頭がおかしいのか？マジで黙ってて欲しい"),
    q(81, "黙っててほしい。マジで"),
    q(16, "うるさ、黙ってろ"),
    q(666, "は？うるさ"),
    q(17, "耳ついてるのかな？？"),
    q(15, "人間舐めんなよマジで"),
    q(813, "日本語通じねぇんだな"),
    x(29, "あれ？この人本当にプロかな？", UNNAMED),
    x(397, "{name}はね、バカだから", RENAMED),
    x(426, "{name}がほんとに下手！ｗ", RENAMED),
    x(409, "{name}もあんましうまくないんすけど～", RENAMED),
    q(768, "分間CSが8とかを下回ってくるとそいつはもう本当にただのZAKOだね", { topic: "lowcs" }),
    q(387, "お前らなんも出来ない中で適当にチャンピョン触ってるんだよね", { topic: "tourist" }),
    q(374, "これマジでトロール、さっき同じ事して殺されてたのにここまで出てきてこのファーム食いに来るのやばすぎる", { topic: "feeder" }),
    q(137, "ふざけてるお前らマジで。LoLを何も見てない！マジで終わってる", { topic: "blind" }),
    q(735, "こういう舐め腐ったADCを見てると腹が立つ", { role: "BOTTOM" }),
    q(53, "このクソJGマジで", { role: "JUNGLE" }),
    q(805, "こちらゲームなんで、あの腕で結構変わりますね...そういう風になってます。", { topic: "losing" }),
    q(21, "LoLやる人って勝ちたい人とどっちでもいい人と両方居て...", { topic: "losing" }),
    q(39, "なんで前行ったの？下がれって言ったじゃん", { topic: "feeder" }),
    q(50, "耐えて耐えて崩壊したならともかく、仕掛けてって崩壊するのは...ワッツ？", { topic: "feeder" }),
    q(13, "本当にファームが下手", { topic: "lowcs" }),
    q(346, "なんでワードない？『ワードないんだよな』意味わかんないんだけど", { topic: "blind" }),
    q(348, "サイドレーンに未来あるわけないでしょ", { topic: "afk", role: "TOP" }),
    q(5, "早く行って、早く行ってよ。意味わからんて", { topic: "afk" }),
    q(12, "観客ですか？って話。死ぬなとは言ったけど下がれとは言ってない", { topic: "lowdamage" }),
    q(161, "チャンピオンは、悪くない", { ...AFTER, topic: "tourist" }),
    q(377, "考えることを放棄しちゃったからどうしようもないね、楽になろうとしたせいで何にもできなくなっちゃった", { ...AFTER, topic: "coinflip" }),
    q(218, "ADCマジでレーニング楽しくしたいヤツ多い！ホントに。サポートがどうのとかJGが来ないとかそういう甘えた事を言ってる", { role: "BOTTOM" }),
    q(246, "ADC？ナイストライ、ナイストライ", { role: "BOTTOM" }),
    TOP_LANER,
  ],
  roast: [
    q(545, "何やってんの？お前さあ・・・"),
    q(195, "酷すぎマジ"),
    q(186, "え？マジぃ！？ちょっとコレよくない"),
    q(577, "ｯﾁはぁ...マジでセンスない。"),
    q(268, "ちゃんとやってない人がいた"),
    q(236, "トロールかな？"),
    q(739, "うーんっ下手！NT！"),
    q(26, "操作が下手なのはしょうがない"),
    q(698, "ボタンが下手なのはいい別に"),
    q(344, "褒めれるところがあったら褒めてたよ"),
    q(51, "これ誰か操作してあげてください", AFTER),
    q(101, "おかしい人が2人も居たら集団戦には勝てない", { ...AFTER, topic: "lowdamage" }),
    q(101, "おかしい人が2人も居たら集団戦には勝てない", { ...AFTER, topic: "coinflip" }),
    q(731, "だからレート上がんないんだよね", AFTER),
    q(166, "え、使えな"),
    q(317, "なんだコイツ！？ホントに役に立たないな！"),
    q(274, "バカ！お前ェ！"),
    q(252, "邪魔！邪魔邪魔邪魔！"),
    q(542, "そっちじゃないでしょ、ばか"),
    x(230, "{name}は動きが悪い", RENAMED),
    q(779, "こいつ馬鹿なんじゃねえか", AFTER),
    q(170, "キモすぎ…キモすぎる。それはちゃんとキモいって", AFTER),
    q(374, "これマジでトロール、さっき同じ事して殺されてたのにここまで出てきてこのファーム食いに来るのやばすぎる", { topic: "feeder" }),
    q(432, "頭おかしくなって戦うこと選ぶくらいなら頭おかしくなってファームしててほしい", { ...AFTER, topic: "feeder" }),
    q(481, "ウルト食らうなよ、マジかよこのADｗ", { topic: "feeder", role: "BOTTOM" }),
    x(482, "このさ～サポートのばかがさあ…一人でビジョンコントロールしに行って死ぬの、ほんとに頭悪いまじでｗ", EXCERPT, { topic: "feeder", role: "UTILITY" }),
    q(768, "分間CSが8とかを下回ってくるとそいつはもう本当にただのZAKOだね", { ...AFTER, topic: "lowcs" }),
    q(768, "分間CSが8とかを下回ってくるとそいつはもう本当にただのZAKOだね", { ...AFTER, topic: "loselane" }),
    x(436, "この世のTOPレーナーの中で{name}だけがウェーブコントロールができない", RENAMED, { topic: "lowcs", role: "TOP" }),
    q(137, "ふざけてるお前らマジで。LoLを何も見てない！マジで終わってる", { topic: "blind" }),
    q(671, "お前よわｗお前マジｗお前よわｗお前よわｗマジなんもせんやんｗ", { topic: "afk" }),
    q(543, "何でお前離れてるんだ？BAKAなのか？", { topic: "afk" }),
    q(730, "こんなサイドに出たチキンを育てるために皆はあなたにファームをあげてないんで", { ...AFTER, topic: "afk", role: "TOP" }),
    x(618, "ジャングル周ってるだけこれ。ロボットだよこれ、ジャングルフルクリアロボットになってる", EXCERPT, { topic: "afk", role: "JUNGLE" }),
    q(403, "ゴミクソカスファイトだった", { ...AFTER, topic: "lowdamage" }),
    x(420, "{name}、キャリーの自覚ないね。君がダメージをそれしか出さないんだったら、この構成はできないよ。", `${RENAMED}・${EXCERPT}`, { topic: "lowdamage" }),
    q(757, "これで逃げてたら一生チキン野郎だね", { ...AFTER, topic: "kdaplayer" }),
    q(198, "すでに負けてる状態からドラゴンを獲ろうとする浅ましいプレイがこうなるんだよね", { ...AFTER, topic: "coinflip" }),
    q(387, "お前らなんも出来ない中で適当にチャンピョン触ってるんだよね", { topic: "tourist" }),
    q(505, "使えないチャンピオンピックして負けるのマジきもすぎる", { ...AFTER, topic: "tourist" }),
    q(149, "お前がきっと疫病神だよ", { ...AFTER, topic: "losing" }),
    x(438, "{name}く～ん勝てないならボット行くのやめようね～w", RENAMED, { topic: "losing", role: "BOTTOM" }),
    q(790, "なんだ最後のゴミマクロ", { ...AFTER, topic: "noobjective" }),
    q(711, "お前スマイト！BAKA！", { topic: "noobjective", role: "JUNGLE" }),
    q(53, "このクソJGマジで", { role: "JUNGLE" }),
    q(363, "このジャングルの人さあ～、なんでこんな……こんなことするの？", { role: "JUNGLE" }),
    q(381, "マジでクソみたいなMidガンクするんだったらTopかBotにガンクしてほしい", { ...AFTER, role: "JUNGLE" }),
    q(672, "遠いなーじゃないんだよねこれ、ゴーレム狩ってる場合じゃねえよカスって言った方がいい", { ...AFTER, role: "JUNGLE", topic: "noobjective" }),
    x(526, "何やってんだこのADC、もういいやこいつ", UNNAMED, { role: "BOTTOM" }),
    q(108, "お前何回それで死ぬんだよ", { ...AFTER, topic: "feeder" }),
    q(639, "こいつ本当に無限に死に続けるな", { ...AFTER, topic: "feeder" }),
    q(732, "すごいところ入ったな、誰も合わせらんねーよそんなん", { topic: "feeder" }),
    q(441, "お前は何のチャンピオンをやれば生きていれるんだ？", { ...AFTER, topic: "feeder" }),
    q(173, "いやADCが1人で敵のジャングルの中に入っていく方がおかしい", { topic: "feeder", role: "BOTTOM" }),
    q(11, "あなたはポジションおかしいよ", { topic: "grayscreen" }),
    q(13, "本当にファームが下手", { topic: "lowcs" }),
    q(42, "ワードワードワードワードなんでなんでなんで、なんで川のワード差しに行かない？", { topic: "blind" }),
    q(346, "なんでワードない？『ワードないんだよな』意味わかんないんだけど", { topic: "nopink" }),
    q(348, "サイドレーンに未来あるわけないでしょ", { topic: "afk", role: "TOP" }),
    q(207, "ハッピーふわふわAFKタイム始まったな", { topic: "afk" }),
    q(539, "自分のことネクサスだと思ってる", { ...AFTER, topic: "afk" }),
    q(388, "あのねぇ・・・行けって言われたら行くんだよね", { topic: "afk" }),
    q(4, "ここは見て、ここは見て、下がりすぎなんだよ。そういうとこだよ、マジで", { topic: "lowdamage" }),
    q(1, "前出て前出て、ｯﾁ", { topic: "lowdamage" }),
    q(49, "ファイトマジで下手、悲しくなっちゃう...なんでこれで負けれる？", { topic: "lowdamage" }),
    q(516, "俺より後ろにいるな", { ...AFTER, topic: "lowdamage" }),
    k(281, "集団戦が、下手だったね♡", { ...AFTER, topic: "lowdamage" }),
    q(12, "観客ですか？って話。死ぬなとは言ったけど下がれとは言ってない", { ...AFTER, topic: "kdaplayer" }),
    q(231, "プライドが出てる、これ。プライドエンゲージです", { ...AFTER, topic: "coinflip" }),
    q(750, "虚無の戦いやめてほしい", { ...AFTER, topic: "coinflip" }),
    q(759, "コア生えてからやるとかさ、そういうの無いん？", { ...AFTER, topic: "coinflip" }),
    q(161, "チャンピオンは、悪くない", { ...AFTER, topic: "tourist" }),
    q(191, "下手だったから負けた", { ...AFTER, topic: "losing" }),
    q(193, "勝たなくてもいいなって思いながらLoLをやってるとしか思えない", { ...AFTER, topic: "losing" }),
    q(37, "勝ちたくて集まったんじゃないんですか？", { topic: "losing" }),
    q(9, "ドラゴン 聞いてる？ドラゴンドラゴンドラゴンドラゴン", { topic: "noobjective" }),
    q(764, "マクロがマジできたない", { ...AFTER, topic: "noobjective" }),
    q(146, "守らないで良いタワーは存在しない", { ...AFTER, topic: "noobjective" }),
    q(3, "この時間帯にゴーレムでファームするJGおまえ自分のレートで見たことあるか？", { role: "JUNGLE", topic: "afk" }),
    q(3, "この時間帯にゴーレムでファームするJGおまえ自分のレートで見たことあるか？", { role: "JUNGLE", topic: "noobjective" }),
    TOP_LANER,
  ],
  verdictHigh: [
    k(290, "ねえねえねえねえ！ねえ！この試合マジ感動した！この試合マジで感動した！感動した！ガチでナイス！"),
    q(683, "GG!!", AFTER),
    k(307, "満足、満足ッ！！", AFTER),
    x(721, "昨日{name}が強すぎて本気で真剣に俺は裏で試合を見ながらこいつ替え玉じゃね？って", RENAMED),
  ],
  verdictLow: [
    // 打ち上げの最終フィードバックで、笑いながら。記事の題に出ている文言
    { text: "このチーム弱ｗ", source: "https://fistbump-news.jp/article/2025/09/10/1554.html(記事の題)" },
    q(416, "あの～自覚ありますかぁ？ちょっと弱すぎないですか？あなた。信じられないぐらい弱い", LOW),
    q(541, "俺は思ったんだ...ゲーム下手だと行き着く先がおかしいんだなって", LOW),
    q(273, "終わっとるやんけ！", LOW),
    q(687, "まぁどんまい。こっからは蛇足だから、どんなミスをしようが。"),
    q(376, "俺思った、チームが弱いほうがやりがいがある。相手のが弱いと申し訳なくなってくる"),
    k(283, "んふふふふｗどんま～い！ｗ"),
    q(142, "俺ね、理解ったよこのゲーム。俺が3人いたら勝てる", AFTER),
    q(202, "無理だったね、わかってたはずだよ", { ...AFTER, ...LOW }),
    q(140, "うーん、終わりで良いんじゃないか？", { ...AFTER, ...LOW }),
    q(334, "弱いなお前マジで", { ...AFTER, ...LOW }),
    q(411, "Not ok give owari", { ...AFTER, ...LOW }),
    q(799, "もういいやなんでも", AFTER),
    q(250, "まあ俺じゃない。ミスったのは", AFTER),
    q(792, "コーチングって、本当くだらない", AFTER),
    q(794, "雑魚雑魚のみなさん、へたっぴだねぇLoLが", LOW),
    q(761, "ZAKOの八宝菜だ", LOW),
    q(209, "カスのカスタムだからしょうがないんだけど"),
    q(289, "ばーかばーか！ﾊﾊｯ ばーかばーか！"),
    q(379, "本当にこれ見てるとちょっと頭悪くなってくる", LOW),
    q(760, "ソロQよええなコイツら。キャリーできない、キャリーできない人間たち。", LOW),
    x(710, "俺{name}をゲームで見てて上手いなって思うこと本当にないから", RENAMED),
    q(635, "俺のタウント、神。そして味方はゴミ", AFTER),
    q(188, "ダメだアイツ使えねぇ。下がろ", { ...AFTER, ...LOW }),
    q(319, "あ～ッ！クソゲー！", { ...AFTER, ...LOW }),
    q(776, "脳みそが低レートになっちゃった", { ...AFTER, ...LOW }),
    x(302, "サポートで一番下手だったのは{name}だったわ", RENAMED, { ...AFTER, role: "UTILITY" }),
    q(77, "助けて、助けて助けて！ADCが弱い！", { ...AFTER, role: "BOTTOM" }),
    q(661, "うーん、君topレーナーじゃないねえ", { ...AFTER, role: "TOP" }),
    TOP_LANER,
  ],
  homework: [
    q(733, "くだらないスキルを吐くのをやめよう", { topic: "lowdamage" }),
    q(733, "くだらないスキルを吐くのをやめよう", { topic: "feeder" }),
    q(733, "くだらないスキルを吐くのをやめよう", { topic: "coinflip" }),
    q(533, "言って出来るやつと出来ねえやつがいるから、とりあえず言ってみるっていうのが大事。"),
    q(177, "いや結構常識だったんで伝え忘れて"),
    q(459, "このままだと勝てないと思うんで今からこのラウンド捨てて作戦会議しましょう。どうやって勝ちます？"),
    q(75, "知能の問題だろこれ。知育させた方がいい", LOW),
    q(532, "内容が難しくないんだからやれよつってるだけなんだよね", AFTER),
    q(715, "わかんないだろうな、まあいいや", AFTER),
    k(181, "ﾏﾀﾞｶﾃﾙﾖ~", AFTER),
    q(313, "殴られたら殴り返さないと俺ら勝てないよ", { ...AFTER, topic: "lowdamage" }),
    q(520, "殴れなかったらポジショニング下手くそだから直した方がいいね", { ...AFTER, topic: "lowdamage" }),
    q(146, "守らないで良いタワーは存在しない", { ...AFTER, topic: "noobjective" }),
    // LTK での助言。2回の別の検索で同じ文言が引用されたが、元の動画では確かめていない
    {
      text: "負けてる時のことは考えなくていいから、負けるな。",
      after: true,
      source: "https://www.youtube.com/watch?v=bV1YgEaybWM(検索結果の引用。表記は未確認)",
    },
  ],
};
