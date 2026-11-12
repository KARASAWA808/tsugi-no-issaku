// 評価役の「口ぐせ」を、組み立てた評価文の前後に差し込む。DOMには触れない。
// 口ぐせは2か所から集める:
//   1. この下の BUILTIN_PHRASES(出典を確かめられたものだけを、出典つきで置く)
//   2. 手元にだけ置く lol/public/local/phrases.json(git 管理外。自分で聞いたことのある言い回しを足す場所)
// 評価の中身(数字へのツッコミ)は自動で組み立てたもので、ご本人の発言ではない。口ぐせは言い回しを借りているだけ。
import type { StrengthId, WeaknessId } from "./analyze";
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
  /** どこで確かめた言い回しか(画面には出さない覚え書き) */
  source?: string;
}

export type PhraseBook = Record<Slot, Phrase[]>;

export const emptyBook = (): PhraseBook => ({
  opening: [], accept: [], reject: [], roast: [], verdictHigh: [], verdictLow: [], homework: [],
});

/** 1つの言い回しの長さと、1つの場所に置ける数の上限(手元のファイルが壊れていても画面が崩れないように) */
const MAX_LENGTH = 80;
const MAX_PER_SLOT = 60;
const MAX_SOURCE_LENGTH = 200;
const ROLES: readonly string[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];
// 型で数えもれを防ぐため、話題の名前はオブジェクトのキーで持つ
const TOPIC_NAMES: Record<PhraseTopic, true> = {
  kda: true, cs: true, vision: true, teamfight: true, damage: true, solokill: true, survive: true,
  objective: true, onetrick: true, winrate: true, firstblood: true, pool: true, multikill: true,
  feeder: true, grayscreen: true, lowcs: true, loselane: true, blind: true, nopink: true, afk: true, lowdamage: true,
  kdaplayer: true, coinflip: true, tourist: true, losing: true, nomad: true, noobjective: true,
  spirit: true,
};
export const PHRASE_TOPICS = Object.keys(TOPIC_NAMES) as PhraseTopic[];

function parsePhrase(item: unknown): Phrase | null {
  const raw = typeof item === "string" ? { text: item } : item;
  if (typeof raw !== "object" || raw === null) return null;
  const { text, after, role, topic, source } = raw as Record<string, unknown>;
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
  if (typeof source === "string" && source.trim() !== "") phrase.source = source.trim().slice(0, MAX_SOURCE_LENGTH);
  return phrase;
}

/**
 * phrases.json の中身を PhraseBook にする。形の合わないところは黙って捨てる。
 * 各場所は、文字列か `{ "text": "...", "after": true, "role": "TOP", "topic": "lowcs" }` の配列。
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

// 文の切れ目になる終わり方。これで終わっていなければ句点を足す
const ENDS_SENTENCE = /[。、,.!?\uFF01\uFF1F…~\uFF5E〜ー♪♡wｗ)\uFF09」』・]$/;

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
): (slot: Slot, line: string, topic?: PhraseTopic) => string {
  const used = new Set<string>();

  return (slot, line, topic) => {
    // 別の場所でもう使った言い回しも、ここでは使わない
    const fresh = book[slot].filter(
      (p) => (p.role === undefined || p.role === role) && (p.topic === undefined || p.topic === topic) && !used.has(p.text),
    );
    if (fresh.length === 0) return line;
    // 出番の少ないものから先に使う
    const onTopic = fresh.filter((p) => p.topic !== undefined);
    const limited = fresh.filter((p) => p.role !== undefined);
    const pool = onTopic.length > 0 ? onTopic : limited.length > 0 ? limited : fresh;
    const phrase = pool[Math.floor(rng() * pool.length)];
    used.add(phrase.text);
    const text = phrase.text.replaceAll("{name}", name);
    const closed = ENDS_SENTENCE.test(text) ? text : `${text}。`;
    return phrase.after ? `${line}${closed}` : `${closed}${line}`;
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
 * 選ぶときの決まり:
 *   - プレイの内容に向けられる言い回しだけ。人の名前が入るもの、容姿・性別・属性に触れるものは入れない
 *   - 「しね」「カス」「バカ」のような暴言は入れない(「下手」「弱い」のようなプレイへの評価は入れる)
 *   - 揉め事に由来する発言、ほかの人の発言は入れない
 */
const SHEET = "らいさまちくちく集";
type Extra = Omit<Phrase, "text" | "source">;
const q = (no: number, text: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET} No.${no}` });
const k = (no: number, text: string, extra: Extra = {}): Phrase => ({ text, ...extra, source: `${SHEET}(かわいい集)No.${no}` });
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
    q(805, "こちらゲームなんで、あの腕で結構変わりますね...そういう風になってます。", { topic: "losing" }),
    q(21, "LoLやる人って勝ちたい人とどっちでもいい人と両方居て...", { topic: "losing" }),
    q(39, "なんで前行ったの？下がれって言ったじゃん", { topic: "feeder" }),
    q(50, "耐えて耐えて崩壊したならともかく、仕掛けてって崩壊するのは...ワッツ？", { topic: "feeder" }),
    q(13, "本当にファームが下手", { topic: "lowcs" }),
    q(346, "なんでワードない？『ワードないんだよな』意味わかんないんだけど", { topic: "blind" }),
    q(348, "サイドレーンに未来あるわけないでしょ", { topic: "afk" }),
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
    q(101, "おかしい人が2人も居たら集団戦には勝てない", AFTER),
    q(731, "だからレート上がんないんだよね", AFTER),
    q(108, "お前何回それで死ぬんだよ", { ...AFTER, topic: "feeder" }),
    q(639, "こいつ本当に無限に死に続けるな", { ...AFTER, topic: "feeder" }),
    q(732, "すごいところ入ったな、誰も合わせらんねーよそんなん", { topic: "feeder" }),
    q(441, "お前は何のチャンピオンをやれば生きていれるんだ？", { ...AFTER, topic: "feeder" }),
    q(173, "いやADCが1人で敵のジャングルの中に入っていく方がおかしい", { topic: "feeder", role: "BOTTOM" }),
    q(11, "あなたはポジションおかしいよ", { topic: "grayscreen" }),
    q(13, "本当にファームが下手", { topic: "lowcs" }),
    q(42, "ワードワードワードワードなんでなんでなんで、なんで川のワード差しに行かない？", { topic: "blind" }),
    q(346, "なんでワードない？『ワードないんだよな』意味わかんないんだけど", { topic: "nopink" }),
    q(348, "サイドレーンに未来あるわけないでしょ", { topic: "afk" }),
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
    q(3, "この時間帯にゴーレムでファームするJGおまえ自分のレートで見たことあるか？", { role: "JUNGLE" }),
    TOP_LANER,
  ],
  verdictHigh: [
    k(290, "ねえねえねえねえ！ねえ！この試合マジ感動した！この試合マジで感動した！感動した！ガチでナイス！"),
    q(683, "GG!!", AFTER),
    k(307, "満足、満足ッ！！", AFTER),
  ],
  verdictLow: [
    // 打ち上げの最終フィードバックで、笑いながら。記事の題に出ている文言
    { text: "このチーム弱ｗ", source: "https://fistbump-news.jp/article/2025/09/10/1554.html(記事の題)" },
    q(416, "あの～自覚ありますかぁ？ちょっと弱すぎないですか？あなた。信じられないぐらい弱い"),
    q(541, "俺は思ったんだ...ゲーム下手だと行き着く先がおかしいんだなって"),
    q(273, "終わっとるやんけ！"),
    q(687, "まぁどんまい。こっからは蛇足だから、どんなミスをしようが。"),
    q(376, "俺思った、チームが弱いほうがやりがいがある。相手のが弱いと申し訳なくなってくる"),
    k(283, "んふふふふｗどんま～い！ｗ"),
    q(142, "俺ね、理解ったよこのゲーム。俺が3人いたら勝てる", AFTER),
    q(202, "無理だったね、わかってたはずだよ", AFTER),
    q(140, "うーん、終わりで良いんじゃないか？", AFTER),
    q(334, "弱いなお前マジで", AFTER),
    q(411, "Not ok give owari", AFTER),
    q(799, "もういいやなんでも", AFTER),
    q(250, "まあ俺じゃない。ミスったのは", AFTER),
    q(792, "コーチングって、本当くだらない", AFTER),
    q(661, "うーん、君topレーナーじゃないねえ", { ...AFTER, role: "TOP" }),
    TOP_LANER,
  ],
  homework: [
    q(733, "くだらないスキルを吐くのをやめよう"),
    q(533, "言って出来るやつと出来ねえやつがいるから、とりあえず言ってみるっていうのが大事。"),
    q(177, "いや結構常識だったんで伝え忘れて"),
    q(459, "このままだと勝てないと思うんで今からこのラウンド捨てて作戦会議しましょう。どうやって勝ちます？"),
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
