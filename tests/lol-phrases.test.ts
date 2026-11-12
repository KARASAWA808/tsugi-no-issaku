import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { buildIntro } from "../lol/src/intro";
import { makeRng } from "../lol/src/labels";
import { EXTREME_PHRASES } from "../lol/src/extreme-phrases";
import { IMAGINED_PHRASES } from "../lol/src/imagined-phrases";
import { EXTRA_PHRASES } from "../lol/src/phrases-extra";
import { BUILTIN_PHRASES, PHRASE_TOPICS, type PhraseBook, SLOTS, countPhrases, emptyBook, makeSpeaker, mergePhrases, parsePhrases, topicsOf } from "../lol/src/phrases";
import { buildReview } from "../lol/src/review";
import { SAMPLE_PLAYERS, samplePlayer } from "../lol/src/sample";

const book = (over: Partial<PhraseBook>): PhraseBook => ({ ...emptyBook(), ...over });

function review(id: string, phrases?: PhraseBook, variant = 0) {
  const player = samplePlayer(id)!;
  // 時間帯の解析が動かす環境の時差で変わらないよう、日本時間で固定する
  const analysis = analyze(player, { utcOffsetMinutes: 540 })!;
  const intro = buildIntro(player, analysis, { variant });
  return buildReview(player, analysis, intro, { variant, phrases });
}

describe("parsePhrases", () => {
  it("文字列と { text, after } の両方を読む", () => {
    const parsed = parsePhrases({ accept: ["いいね", { text: "だよね", after: true }] });
    expect(parsed.accept).toEqual([{ text: "いいね" }, { text: "だよね", after: true }]);
    expect(parsed.reject).toEqual([]);
  });

  it("形の合わないものは捨てる(壊れたファイルでも落ちない)", () => {
    for (const broken of [null, 3, "x", [], { accept: "ひとつだけ" }, { accept: [1, null, {}, { text: 5 }, "", "   "] }]) {
      expect(countPhrases(parsePhrases(broken))).toBe(0);
    }
  });

  it("知らない場所の名前は無視する", () => {
    expect(countPhrases(parsePhrases({ somewhere: ["あ"], opening: ["い"] }))).toBe(1);
  });

  it("長すぎる言い回しと、多すぎるぶんは入れない", () => {
    expect(parsePhrases({ roast: ["あ".repeat(241), "い".repeat(240)] }).roast).toHaveLength(1);
    expect(parsePhrases({ roast: Array.from({ length: 500 }, (_, i) => `口ぐせ${i}`) }).roast).toHaveLength(200);
  });

  it("ロール限定を読む。知らないロール名のものは、全員に出ないよう捨てる", () => {
    const parsed = parsePhrases({ roast: [{ text: "トップだけ", role: "TOP" }, { text: "書きまちがい", role: "TOPP" }, { text: "数字", role: 1 }] });
    expect(parsed.roast).toEqual([{ text: "トップだけ", role: "TOP" }]);
  });

  it("話題の限定を読む。知らない話題のものは捨てる", () => {
    const parsed = parsePhrases({ roast: [{ text: "CSの話", topic: "lowcs" }, { text: "書きまちがい", topic: "cs不足" }] });
    expect(parsed.roast).toEqual([{ text: "CSの話", topic: "lowcs" }]);
  });

  it("話題は複数書ける。ひとつでも知らない話題が混ざっていれば捨てる", () => {
    const parsed = parsePhrases({ roast: [{ text: "デスの話", topic: ["feeder", "earlydeath"] }, { text: "混ざりもの", topic: ["feeder", "なにか"] }, { text: "空", topic: [] }] });
    expect(parsed.roast).toEqual([{ text: "デスの話", topic: ["feeder", "earlydeath"] }]);
  });

  it("評価の限定を読む。知らない評価や空の一覧は、だれにでも出ないよう捨てる", () => {
    const parsed = parsePhrases({ opening: [{ text: "低いとき", grades: ["C", "D"] }, { text: "書きまちがい", grades: ["E"] }, { text: "空", grades: [] }, { text: "形ちがい", grades: "D" }] });
    expect(parsed.opening).toEqual([{ text: "低いとき", grades: ["C", "D"] }]);
  });

  it("チャンピオンの限定を読む。IDの形でないものは捨てる", () => {
    const parsed = parsePhrases({ aside: [{ text: "ヤスオの話", champion: "Yasuo" }, { text: "2体", champion: ["Zed", "Yone"] }, { text: "日本語名", champion: "ヤスオ" }, { text: "空", champion: [] }] });
    expect(parsed.aside).toEqual([{ text: "ヤスオの話", champion: "Yasuo" }, { text: "2体", champion: ["Zed", "Yone"] }]);
  });

  it("出典の覚え書きは残す", () => {
    expect(parsePhrases({ opening: [{ text: "はい", source: " クリップ " }] }).opening).toEqual([{ text: "はい", source: "クリップ" }]);
  });

  it("前後の空白は落とす", () => {
    expect(parsePhrases({ opening: ["  はい  "] }).opening).toEqual([{ text: "はい" }]);
  });
});

describe("mergePhrases", () => {
  it("場所ごとに合わせ、同じ言い回しは1つにする", () => {
    const merged = mergePhrases(book({ accept: [{ text: "いいね" }] }), book({ accept: [{ text: "いいね" }, { text: "えらい" }], roast: [{ text: "あと" }] }));
    expect(merged.accept.map((p) => p.text)).toEqual(["いいね", "えらい"]);
    expect(merged.roast).toEqual([{ text: "あと" }]);
  });
});

describe("makeSpeaker", () => {
  it("口ぐせがなければ、評価文をそのまま返す", () => {
    expect(makeSpeaker(emptyBook(), makeRng(1), "テスト")("accept", "本文。")).toBe("本文。");
  });

  it("前に付けるときは、文の切れ目がなければ句点を足す", () => {
    const say = makeSpeaker(book({ accept: [{ text: "いいね" }], reject: [{ text: "いや、" }] }), makeRng(1), "テスト");
    expect(say("accept", "本文。")).toBe("いいね。本文。");
    expect(say("reject", "本文。")).toBe("いや、本文。");
  });

  it("？や！、伸ばしで終わる言い回しには句点を足さず、1字あけてつなぐ", () => {
    const say = makeSpeaker(book({ accept: [{ text: "マジ？" }], reject: [{ text: "いいね～～" }], roast: [{ text: "下手！" }] }), makeRng(1), "テスト");
    expect(say("accept", "本文。")).toBe("マジ？ 本文。");
    expect(say("reject", "本文。")).toBe("いいね～～ 本文。");
    expect(say("roast", "本文。")).toBe("下手！ 本文。");
  });

  it("読点で終わる言い回しは、そのまま本文につなぐ", () => {
    expect(makeSpeaker(book({ roast: [{ text: "あとさぁ、" }] }), makeRng(1), "テスト")("roast", "本文。")).toBe("あとさぁ、本文。");
  });

  it("後ろに付けるときも、文の切れ目がなければ句点を足す", () => {
    expect(makeSpeaker(book({ roast: [{ text: "勝てる", after: true }] }), makeRng(1), "テスト")("roast", "本文。")).toBe("本文。勝てる。");
  });

  it("after なら後ろに付ける", () => {
    expect(makeSpeaker(book({ roast: [{ text: "知らんけど。", after: true }] }), makeRng(1), "テスト")("roast", "本文。")).toBe("本文。知らんけど。");
  });

  it("{name} をプレイヤー名に置きかえる", () => {
    expect(makeSpeaker(book({ opening: [{ text: "{name}さん、" }] }), makeRng(1), "テスト")("opening", "本文。")).toBe("テストさん、本文。");
  });

  it("ロール限定の言い回しは、そのロールの人にだけ使う", () => {
    const only = book({ roast: [{ text: "トップ限定、", role: "TOP" }] });
    expect(makeSpeaker(only, makeRng(1), "テスト", "TOP")("roast", "x")).toBe("トップ限定、x");
    expect(makeSpeaker(only, makeRng(1), "テスト", "MIDDLE")("roast", "x")).toBe("x");
    expect(makeSpeaker(only, makeRng(1), "テスト")("roast", "x")).toBe("x");
  });

  it("ロール限定の言い回しが使えるときは、先に使う", () => {
    const mixed = book({ roast: [{ text: "だれでも、" }, { text: "トップ限定、", role: "TOP" }, { text: "これも、" }] });
    for (let seed = 0; seed < 10; seed++) expect(makeSpeaker(mixed, makeRng(seed), "テスト", "TOP")("roast", "x")).toBe("トップ限定、x");
  });

  it("話題の合う言い回しが多ければ必ずそこから使い、合わない話題のものは使わない", () => {
    const topical = ["CSの話1、", "CSの話2、", "CSの話3、", "CSの話4、", "CSの話5、"];
    const mixed = book({ roast: [{ text: "だれでも、" }, ...topical.map((text) => ({ text, topic: "lowcs" as const })), { text: "視界の話、", topic: "blind" }] });
    for (let seed = 0; seed < 20; seed++) {
      const say = makeSpeaker(mixed, makeRng(seed), "テスト");
      expect(topical.map((t) => `${t}x`)).toContain(say("roast", "x", "lowcs"));
      // どの呼び出しでも、別の話題のものは出ない
      for (let i = 0; i < 6; i++) expect(say("roast", "x", "lowcs")).not.toContain("視界の話");
    }
  });

  it("話題の合う言い回しが1つしかないときは、4割くらいだけ使う(だれを見ても同じ台詞にならないように)", () => {
    const mixed = book({ roast: [{ text: "だれでも1、" }, { text: "だれでも2、" }, { text: "CSの話、", topic: "lowcs" }] });
    let topical = 0;
    for (let seed = 0; seed < 300; seed++) if (makeSpeaker(mixed, makeRng(seed), "テスト")("roast", "x", "lowcs") === "CSの話、x") topical += 1;
    expect(topical).toBeGreaterThan(90);
    expect(topical).toBeLessThan(150);
    // 話題を選ばない言い回しが無ければ、1つしかなくても必ず使う
    const only = book({ roast: [{ text: "CSの話、", topic: "lowcs" }] });
    for (let seed = 0; seed < 10; seed++) expect(makeSpeaker(only, makeRng(seed), "テスト")("roast", "x", "lowcs")).toBe("CSの話、x");
  });

  it("複数の話題を書いた言い回しは、そのどれかの評価文に使う", () => {
    const many = book({ roast: [{ text: "デスの話、", topic: ["feeder", "earlydeath"] }] });
    expect(makeSpeaker(many, makeRng(1), "テスト")("roast", "x", "earlydeath")).toBe("デスの話、x");
    expect(makeSpeaker(many, makeRng(1), "テスト")("roast", "x", "feeder")).toBe("デスの話、x");
    expect(makeSpeaker(many, makeRng(1), "テスト")("roast", "x", "tilt")).toBe("x");
  });

  it("話題を渡さない場所では、話題つきの言い回しは使わない", () => {
    const only = book({ verdictLow: [{ text: "CSの話、", topic: "lowcs" }] });
    expect(makeSpeaker(only, makeRng(1), "テスト")("verdictLow", "x")).toBe("x");
  });

  it("評価を限定した言い回しは、その評価の人にだけ使う", () => {
    const only = book({ opening: [{ text: "低いとき、", grades: ["C", "D"] }] });
    expect(makeSpeaker(only, makeRng(1), "テスト", "MIDDLE", "D")("opening", "x")).toBe("低いとき、x");
    expect(makeSpeaker(only, makeRng(1), "テスト", "MIDDLE", "B")("opening", "x")).toBe("x");
    // 評価を渡さないときは、限定つきのものは使わない
    expect(makeSpeaker(only, makeRng(1), "テスト")("opening", "x")).toBe("x");
  });

  it("チャンピオンを限定した言い回しは、そのチャンピオンを使った人にだけ、いちばん先に使う", () => {
    const mixed = book({ aside: [{ text: "雑談" }, { text: "ヤスオの話", champion: "Yasuo" }, { text: "デスの話", topic: "feeder" }] });
    for (let seed = 0; seed < 10; seed++) {
      const yasuo = makeSpeaker(mixed, makeRng(seed), "テスト", "MIDDLE", "D", new Set(["Yasuo", "Zed"]));
      expect(yasuo("aside", "", "feeder")).toBe("ヤスオの話。");
      // 残りの2つは、どちらが先でもよい
      expect(new Set([yasuo("aside", "", "feeder"), yasuo("aside", "", "feeder")])).toEqual(new Set(["デスの話。", "雑談。"]));
      const ahri = makeSpeaker(mixed, makeRng(seed), "テスト", "MIDDLE", "D", new Set(["Ahri"]));
      expect(ahri("aside", "")).toBe("雑談。");
      expect(ahri("aside", "")).toBe("");
    }
  });

  it("本文なしで呼ぶと(脱線)、言い回しだけを返す", () => {
    const say = makeSpeaker(book({ aside: [{ text: "犬派なんだよね" }, { text: "マジ？", after: true }] }), makeRng(2), "テスト");
    expect(new Set([say("aside", ""), say("aside", "")])).toEqual(new Set(["犬派なんだよね。", "マジ？"]));
  });

  it("同じ言い回しは1度だけ。使い切った場所には何も付けない", () => {
    const texts = ["あ、", "い、", "う、"];
    const say = makeSpeaker(book({ roast: texts.map((text) => ({ text })) }), makeRng(7), "テスト");
    const firstRound = [say("roast", "x"), say("roast", "x"), say("roast", "x")];
    expect(new Set(firstRound)).toEqual(new Set(texts.map((t) => `${t}x`)));
    expect(say("roast", "x")).toBe("x");
  });

  it("別の場所でもう使った言い回しは使わない", () => {
    const shared = { text: "同じ、" };
    const say = makeSpeaker(book({ accept: [shared], reject: [shared, { text: "別の、" }], roast: [shared] }), makeRng(3), "テスト");
    expect(say("accept", "x")).toBe("同じ、x");
    expect(say("reject", "x")).toBe("別の、x");
    expect(say("roast", "x")).toBe("x");
  });
});

describe("buildReview と口ぐせ", () => {
  const all = book(Object.fromEntries(SLOTS.map((slot) => [slot, [{ text: `【${slot}】、` }]])));

  it("口ぐせを足しても、元の評価文は変わらない(前に付くだけ)", () => {
    const strip = (text: string) => text.replace(/^【[a-zA-Z]+】、/, "");
    for (const s of SAMPLE_PLAYERS) {
      const plain = review(s.id);
      const spoken = review(s.id, all);
      expect(spoken.opening).toBe(`【opening】、${plain.opening}`);
      expect(spoken.homework).toBe(`【homework】、${plain.homework}`);
      expect(spoken.replies.map((r) => strip(r.text))).toEqual(plain.replies.map((r) => r.text));
      expect(spoken.roasts.map((r) => strip(r.text))).toEqual(plain.roasts.map((r) => r.text));
      // 場所ごとに1つしか口ぐせがないので、付くのはそれぞれ最初の1回だけ
      for (const [accepted, mark] of [[true, "【accept】、"], [false, "【reject】、"]] as const) {
        const texts = spoken.replies.filter((r) => r.accepted === accepted).map((r) => r.text);
        expect(texts.map((t) => t.startsWith(mark))).toEqual(texts.map((_, i) => i === 0));
      }
      // 弱みのない人への軽い指摘(軸の名前が topic)には付けない
      const marked = spoken.roasts.filter((r) => r.text.startsWith("【roast】、"));
      expect(marked).toHaveLength(plain.roasts.length > 0 && spoken.roasts[0].topic in { laning: 1, fighting: 1, vision: 1, survival: 1, objective: 1, consistency: 1 } ? 0 : Math.min(1, spoken.roasts.length));
      // 称号には付けない
      expect(spoken.title).toBe(plain.title);
    }
  });

  it("総評は、評価の高さで使う場所が変わる", () => {
    expect(review("jg-solid", all).verdict.startsWith("【verdictHigh】")).toBe(true);
    expect(review("mid-feeder", all).verdict.startsWith("【verdictLow】")).toBe(true);
  });

  it("同じ人・同じ variant なら、口ぐせの選ばれ方も同じ", () => {
    const many = book({ roast: ["あ、", "い、", "う、", "え、"].map((text) => ({ text })) });
    expect(review("mid-feeder", many, 1)).toEqual(review("mid-feeder", many, 1));
  });
});

// 「死ぬな」「殺されてた」「殴り返す」はゲームの中の話なので引っかけない
const BANNED_VIOLENCE = /しね|死ね|死んで|死んどけ|しんどけ|4ね|〇ね|56[しせ]|ぶん殴|殺す|殺せ/;
const BANNED_BODY = /女|男|ババア|ジジイ|デブ|ブタ|太っ|体型|体脂肪|メガネ|(?<!サ)ブス|生え際|顔キモ|ちんちん/;
// シートに出てくる、まわりの配信者・選手の呼び名
const BANNED_NAMES = /zerost|ぜろすと|ゼロスト|たかや|たかス|じゃす|ジャス|しゃる|スタンミ|スタは|忍者|にんにん|なぎさっち|とおこ|葛葉|くずは|evi|えび|みっちー|ヘンディー|ローレン|UG|あかりん|メイカ|めいか|ボドカ|おぼ|象先輩|釈迦|shaka|k4sen|かせん|アルファ|INO|りーちゃん|ひなーの|ひなの|うるーか|よむ|よいち|day1|ta1yo|清川|増永|増アカ|代表|faker|zeus|菅原|村瀬|星野|らむち|なちょ|ういにゃん|あーちゃん|マーブル|わらぶい|ハムさん|ゆきお|rain/i;

describe("BUILTIN_PHRASES", () => {
  const entries = SLOTS.flatMap((slot) => BUILTIN_PHRASES[slot].map((phrase) => ({ slot, phrase })));
  const text = (r: ReturnType<typeof review>) =>
    [r.opening, ...r.replies.map((x) => x.text), ...r.roasts.map((x) => x.text), r.verdict, r.homework].join("\n");

  it("どの場所も、読み込みと同じ決まり(80文字まで・空でない・ロールと話題の名前が正しい)を守っている", () => {
    expect(parsePhrases(BUILTIN_PHRASES)).toEqual(BUILTIN_PHRASES);
  });

  it("すべてに出典が書いてある", () => {
    for (const { phrase } of entries) expect(phrase.source, phrase.text).toBeTruthy();
  });

  it("死や暴力を願う言葉は入れていない(「バカ」「カス」のような暴言は、遊ぶ本人が望んだので入れている)", () => {
    for (const { phrase } of entries) expect(phrase.text, phrase.text).not.toMatch(BANNED_VIOLENCE);
  });

  it("容姿・体型・性別に触れる言葉は入れていない", () => {
    for (const { phrase } of entries) expect(phrase.text, phrase.text).not.toMatch(BANNED_BODY);
  });

  it("ほかの実在の人の名前は入れていない(名指しの発言は {name} に置きかえる)", () => {
    for (const { phrase } of entries) expect(phrase.text, phrase.text).not.toMatch(BANNED_NAMES);
  });

  it("加工したものは、出典に何をしたか書いてある", () => {
    for (const { phrase } of entries) {
      if (phrase.text.includes("{name}")) expect(phrase.source, phrase.text).toMatch(/名前を置きかえ/);
    }
    // 言い回しを変えたものには、その断り書きがある(元の表記と取りちがえないように)
    const reworded = entries.filter(({ phrase }) => phrase.source?.includes("言い回しを一部改変"));
    expect(reworded.length).toBeGreaterThan(10);
    for (const text of ["ビジョン取りおくんじゃん", "この人弱ｗ", "こいつなんで寝ないんだよ", "操作が下手なのはしょうがない。ただ、"]) {
      expect(reworded.some(({ phrase }) => phrase.text === text), text).toBe(true);
    }
  });

  it("どの場所にも口ぐせがある(追加の口ぐせと合わせて)", () => {
    const merged = mergePhrases(BUILTIN_PHRASES, EXTRA_PHRASES);
    for (const slot of SLOTS) expect(merged[slot].length, slot).toBeGreaterThan(0);
  });

  it("ロール限定の口ぐせは、そのロールのサンプルにだけ出る", () => {
    const top = /TOPレーナーとして|topレーナーじゃない/;
    const support = "いちばん替えたくないのが、こういうサポート。";
    const all = (id: string) => Array.from({ length: 30 }, (_, variant) => text(review(id, BUILTIN_PHRASES, variant))).join("\n");
    for (const s of SAMPLE_PLAYERS) {
      const t = all(s.id);
      expect(top.test(t), s.id).toBe(s.id === "top-farmer");
      expect(t.includes(support), s.id).toBe(s.id === "sup-vision");
    }
    // 1回の評価の中では1度だけ
    expect(text(review("sup-vision", BUILTIN_PHRASES)).split(support).length - 1).toBeLessThanOrEqual(1);
  });

  it("話題の合う口ぐせが付く(デスの多い人にはデスの話、視界のない人にはワードの話)", () => {
    // 話題の合う口ぐせは毎回付くわけではないので、何回か言い直した中で確かめる
    const several = (id: string) => Array.from({ length: 12 }, (_, variant) => text(review(id, BUILTIN_PHRASES, variant))).join("\n");
    expect(several("mid-feeder")).toMatch(/なんで前行ったの|仕掛けてって崩壊|何回それで死ぬ|無限に死に続ける|すごいところ入ったな|生きていれるんだ/);
    expect(several("adc-noward")).toMatch(/ワード/);
    expect(several("top-farmer")).toContain("ファームおいちい");
  });

  /** 口ぐせなしの評価と見くらべて、各吹き出しに足されたぶんだけを取り出す */
  function added(id: string, variant: number): string[] {
    const plain = review(id, undefined, variant);
    const spoken = review(id, BUILTIN_PHRASES, variant);
    const pairs = [
      [plain.opening, spoken.opening], [plain.verdict, spoken.verdict], [plain.homework, spoken.homework],
      ...plain.replies.map((r, i) => [r.text, spoken.replies[i].text]),
      ...plain.roasts.map((r, i) => [r.text, spoken.roasts[i].text]),
    ];
    return pairs.map(([a, b]) => b.replace(a, ""));
  }

  it("同じ口ぐせを1回の評価で2度使わない", () => {
    for (const s of SAMPLE_PLAYERS) {
      for (let variant = 0; variant < 8; variant++) {
        const used = added(s.id, variant).filter((t) => t !== "");
        expect(new Set(used).size, used.join(" / ")).toBe(used.length);
      }
    }
  });

  it("どのサンプルでも、ほとんどの吹き出しに口ぐせが付く", () => {
    for (const s of SAMPLE_PLAYERS) {
      const parts = added(s.id, 0);
      // 付かないのは、弱みのない人への軽い指摘くらい
      expect(parts.filter((t) => t !== "").length).toBeGreaterThanOrEqual(parts.length - 1);
    }
  });
});

describe("IMAGINED_PHRASES(言いそうな台詞として作ったもの)", () => {
  const entries = SLOTS.flatMap((slot) => IMAGINED_PHRASES[slot].map((phrase) => ({ slot, phrase })));
  const realTexts = new Set(SLOTS.flatMap((slot) => BUILTIN_PHRASES[slot].map((p) => p.text)));

  it("読み込みと同じ決まりを守り、すべてに「作ったもの」の印と出典の断り書きがある", () => {
    expect(parsePhrases(IMAGINED_PHRASES)).toEqual(IMAGINED_PHRASES);
    for (const { phrase } of entries) {
      expect(phrase.imagined, phrase.text).toBe(true);
      expect(phrase.source, phrase.text).toMatch(/^創作/);
    }
  });

  it("実際の発言の表には、作った台詞の印が付いたものが無い", () => {
    for (const slot of SLOTS) for (const phrase of BUILTIN_PHRASES[slot]) expect(phrase.imagined, phrase.text).toBeUndefined();
  });

  it("実際の発言と同じ文は入れていない(どちらなのか分からなくなるため)", () => {
    for (const { phrase } of entries) expect(realTexts.has(phrase.text), phrase.text).toBe(false);
  });

  it("実際の発言と同じ決まりを守る(死や暴力・容姿や性別・実在の人の名前を入れない)", () => {
    for (const { phrase } of entries) {
      expect(phrase.text, phrase.text).not.toMatch(BANNED_VIOLENCE);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_BODY);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_NAMES);
    }
  });

  it("どの話題にも、合わせられる口ぐせが少なくとも1つある(実際の発言と合わせて)", () => {
    const covered = new Set(
      [BUILTIN_PHRASES, IMAGINED_PHRASES].flatMap((book) => SLOTS.flatMap((slot) => book[slot].flatMap((p) => topicsOf(p)))),
    );
    for (const topic of PHRASE_TOPICS) expect(covered.has(topic), topic).toBe(true);
  });

  it("作った台詞は、実際の発言より出にくい", () => {
    const mixed = book({ roast: [{ text: "実際、" }, { text: "創作、", imagined: true }] });
    let real = 0;
    for (let seed = 0; seed < 300; seed++) if (makeSpeaker(mixed, makeRng(seed), "テスト")("roast", "x") === "実際、x") real += 1;
    // 重みは 1 : 0.5 なので、実際の発言が3分の2くらい
    expect(real).toBeGreaterThan(170);
    expect(real).toBeLessThan(230);
  });

  it("話題に合うのが作った台詞だけのときは、数が多くても半分くらいは実際の発言に出番をゆずる", () => {
    const count = (imagined: boolean): number => {
      const topical = ["話題1、", "話題2、", "話題3、", "話題4、", "話題5、"].map((text) => ({ text, topic: "tilt" as const, ...(imagined ? { imagined: true } : {}) }));
      const mixed = book({ roast: [{ text: "実際、" }, ...topical] });
      let hits = 0;
      for (let seed = 0; seed < 300; seed++) if (makeSpeaker(mixed, makeRng(seed), "テスト")("roast", "x", "tilt") !== "実際、x") hits += 1;
      return hits;
    };
    // 作った台詞だけなら半分くらい、実際の発言なら(5つあるので)必ず話題が先
    expect(count(true)).toBeGreaterThan(120);
    expect(count(true)).toBeLessThan(180);
    expect(count(false)).toBe(300);
  });

  it("混ぜても、同じ口ぐせを1回の評価で2度使わない", () => {
    const merged = mergePhrases(BUILTIN_PHRASES, IMAGINED_PHRASES);
    for (const s of SAMPLE_PLAYERS) {
      for (let variant = 0; variant < 6; variant++) {
        const plain = review(s.id, undefined, variant);
        const spoken = review(s.id, merged, variant);
        const pairs = [
          [plain.opening, spoken.opening], [plain.verdict, spoken.verdict], [plain.homework, spoken.homework],
          ...plain.replies.map((r, i) => [r.text, spoken.replies[i].text]),
          ...plain.roasts.map((r, i) => [r.text, spoken.roasts[i].text]),
        ];
        const used = pairs.map(([a, b]) => b.replace(a, "")).filter((t) => t !== "");
        expect(new Set(used).size, used.join(" / ")).toBe(used.length);
      }
    }
  });
});

describe("口ぐせと本文のかみ合わせ(実際の発言と創作を混ぜた状態で)", () => {
  const merged = mergePhrases(BUILTIN_PHRASES, EXTRA_PHRASES, IMAGINED_PHRASES);
  /** そのサンプルを40回言い直したときに出る文章を全部つなげたもの */
  const everything = (id: string): string =>
    Array.from({ length: 40 }, (_, variant) => {
      const r = review(id, merged, variant);
      return [r.opening, ...r.replies.map((x) => x.text), ...r.roasts.map((x) => x.text), r.verdict, r.homework].join("\n");
    }).join("\n");
  const texts = Object.fromEntries(SAMPLE_PLAYERS.map((s) => [s.id, everything(s.id)]));

  it("評価の高い人に、皮肉やきつい言い回しを付けない", () => {
    // jg-solid は S、sup-vision は A
    for (const id of ["jg-solid", "sup-vision"]) {
      expect(texts[id]).not.toContain("下手くそだなと思ったらベイト");
      expect(texts[id]).not.toMatch(/頭おかしくなってるやつ|アホが来た|クソだりぃ|見なきゃダメですか/);
    }
  });

  it("B の人には、C・D 向けのきつい冒頭と総評を付けない", () => {
    // top-farmer と adc-noward は B
    for (const id of ["top-farmer", "adc-noward"]) {
      expect(texts[id]).not.toMatch(/頭おかしくなってるやつ|アホが来た|クソだりぃ/);
      expect(texts[id]).not.toMatch(/終わっとるやんけ|ZAKOの八宝菜|信じられないぐらい弱い|解散でーす|知育させた方がいい/);
    }
    // D の人には出る
    expect(texts["mid-feeder"]).toMatch(/頭おかしくなってるやつ|アホが来た|クソだりぃ/);
    expect(texts["mid-feeder"]).toMatch(/終わっとるやんけ|ZAKOの八宝菜|信じられないぐらい弱い|解散でーす/);
  });

  it("サイドレーンの話はトップにだけ、ジャングルのファームの話はジャングルにだけ出る", () => {
    for (const s of SAMPLE_PLAYERS) {
      if (s.id !== "top-farmer") expect(texts[s.id], s.id).not.toMatch(/サイドに出たチキン|サイドレーンに未来/);
      if (s.id !== "jg-solid") expect(texts[s.id], s.id).not.toMatch(/ゴーレム/);
    }
  });

  it("スキルや集団戦の話は、関係する弱みのある人にだけ出る", () => {
    // adc-noward と sup-vision には、デス・ダメージ・波の弱みが無い
    for (const id of ["adc-noward", "sup-vision", "jg-solid"]) {
      expect(texts[id], id).not.toContain("くだらないスキルを吐く");
      expect(texts[id], id).not.toContain("おかしい人が2人も居たら");
    }
  });
});

// 性別をけなす言葉。過激な口ぐせにも入れない
const BANNED_GENDER = /女|男のくせ|ババア|(?<!サ)ブス|メス|ちんちん/;

describe("EXTRA_PHRASES(追加の口ぐせ。場面が固有のもの・長いもの・雑談)", () => {
  const entries = SLOTS.flatMap((slot) => EXTRA_PHRASES[slot].map((phrase) => ({ slot, phrase })));

  it("読み込みと同じ決まりを守り、すべてに出典がある", () => {
    expect(parsePhrases(EXTRA_PHRASES)).toEqual(EXTRA_PHRASES);
    for (const { phrase } of entries) expect(phrase.source, phrase.text).toMatch(/^らいさまちくちく集/);
  });

  it("最初から出る口ぐせなので、死や暴力を願う言葉・見た目へのいじり・性別をけなす言葉・実在の人の名前を入れない", () => {
    for (const { phrase } of entries) {
      expect(phrase.text, phrase.text).not.toMatch(BANNED_VIOLENCE);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_BODY);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_GENDER);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_NAMES);
    }
  });

  it("言い回しを変えたものや抜粋には、出典にそう書いてある", () => {
    for (const { phrase } of entries) {
      if (phrase.text.includes("{name}")) expect(phrase.source, phrase.text).toMatch(/名前を置きかえ/);
    }
    expect(entries.filter(({ phrase }) => /言い回しを一部改変|抜粋|名前を省略/.test(phrase.source ?? "")).length).toBeGreaterThan(20);
  });

  it("脱線には、雑談と、チャンピオンの話と、弱みに合わせた長い話がある", () => {
    const asides = EXTRA_PHRASES.aside;
    expect(asides.filter((p) => p.champion === undefined && p.topic === undefined).length).toBeGreaterThan(40);
    expect(asides.filter((p) => p.champion !== undefined).length).toBeGreaterThan(30);
    expect(asides.filter((p) => p.topic !== undefined).length).toBeGreaterThan(10);
  });
});

describe("EXTREME_PHRASES(過激な口ぐせ。自分でチェックを入れたときだけ)", () => {
  const entries = SLOTS.flatMap((slot) => EXTREME_PHRASES[slot].map((phrase) => ({ slot, phrase })));
  const usual = [BUILTIN_PHRASES, EXTRA_PHRASES, IMAGINED_PHRASES];

  it("読み込みと同じ決まりを守り、すべてに出典がある", () => {
    expect(parsePhrases(EXTREME_PHRASES)).toEqual(EXTREME_PHRASES);
    for (const { phrase } of entries) expect(phrase.source, phrase.text).toMatch(/^らいさまちくちく集/);
  });

  it("過激な口ぐせにも、性別をけなす言葉と実在の人の名前は入れない", () => {
    for (const { phrase } of entries) {
      expect(phrase.text, phrase.text).not.toMatch(BANNED_GENDER);
      expect(phrase.text, phrase.text).not.toMatch(BANNED_NAMES);
    }
  });

  it("死や暴力を願う言葉と見た目へのいじりは、ここにだけある", () => {
    for (const book of usual) {
      for (const slot of SLOTS) {
        for (const phrase of book[slot]) {
          expect(phrase.text, phrase.text).not.toMatch(BANNED_VIOLENCE);
          expect(phrase.text, phrase.text).not.toMatch(BANNED_BODY);
        }
      }
    }
    expect(entries.some(({ phrase }) => BANNED_VIOLENCE.test(phrase.text))).toBe(true);
    expect(entries.some(({ phrase }) => BANNED_BODY.test(phrase.text))).toBe(true);
  });

  it("ふだんの口ぐせと同じ文は入れていない(チェックを外したのに出る、ということがないように)", () => {
    const usualTexts = new Set(usual.flatMap((book) => SLOTS.flatMap((slot) => book[slot].map((p) => p.text))));
    for (const { phrase } of entries) expect(usualTexts.has(phrase.text), phrase.text).toBe(false);
  });
});

describe("脱線(評価文には付けず、独立して出すひとこと)", () => {
  const merged = mergePhrases(BUILTIN_PHRASES, EXTRA_PHRASES, IMAGINED_PHRASES);

  it("口ぐせを渡さなければ、脱線は出ない", () => {
    for (const s of SAMPLE_PLAYERS) expect(review(s.id).asides).toEqual([]);
  });

  it("脱線は2つまでで、同じものを2度出さない", () => {
    for (const s of SAMPLE_PLAYERS) {
      for (let variant = 0; variant < 20; variant++) {
        const { asides } = review(s.id, merged, variant);
        expect(asides.length).toBeGreaterThanOrEqual(1);
        expect(asides.length).toBeLessThanOrEqual(2);
        expect(new Set(asides).size).toBe(asides.length);
        for (const text of asides) expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("使っているチャンピオンの話は、そのチャンピオンを使った人にだけ出る", () => {
    const all = (id: string) => Array.from({ length: 40 }, (_, variant) => review(id, merged, variant).asides.join("\n")).join("\n");
    const texts = Object.fromEntries(SAMPLE_PLAYERS.map((s) => [s.id, all(s.id)]));
    // mid-feeder は Yasuo と Zed、top-farmer は Nasus、jg-solid は LeeSin を使っている
    expect(texts["mid-feeder"]).toMatch(/ヤスシ|ゼド/);
    expect(texts["top-farmer"]).toContain("ナサス");
    expect(texts["jg-solid"]).toContain("キック");
    for (const s of SAMPLE_PLAYERS) {
      if (s.id !== "mid-feeder") expect(texts[s.id], s.id).not.toMatch(/ヤスシ|ゼド使って/);
      if (s.id !== "top-farmer") expect(texts[s.id], s.id).not.toContain("ナサス");
    }
  });

  it("過激な口ぐせを混ぜなければ、「しね」も見た目へのいじりも出ない。混ぜると出る", () => {
    const everything = (phrases: PhraseBook) =>
      SAMPLE_PLAYERS.flatMap((s) =>
        Array.from({ length: 30 }, (_, variant) => {
          const r = review(s.id, phrases, variant);
          return [r.opening, ...r.replies.map((x) => x.text), ...r.roasts.map((x) => x.text), ...r.asides, r.verdict, r.homework].join("\n");
        }),
      ).join("\n");
    const usual = everything(merged);
    expect(usual).not.toMatch(/しね|死ね|死んどけ|しんどけ|ぶん殴/);
    expect(usual).not.toMatch(/デブ|太くね|メガネ|お腹が出てる/);
    const extreme = everything(mergePhrases(merged, EXTREME_PHRASES));
    expect(extreme).toMatch(/しね|死ね|死んどけ|しんどけ/);
  });
});
