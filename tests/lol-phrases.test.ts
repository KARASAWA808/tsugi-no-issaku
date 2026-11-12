import { describe, expect, it } from "vitest";
import { analyze } from "../lol/src/analyze";
import { buildIntro } from "../lol/src/intro";
import { makeRng } from "../lol/src/labels";
import { IMAGINED_PHRASES } from "../lol/src/imagined-phrases";
import { BUILTIN_PHRASES, PHRASE_TOPICS, type PhraseBook, SLOTS, countPhrases, emptyBook, makeSpeaker, mergePhrases, parsePhrases } from "../lol/src/phrases";
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
    expect(parsePhrases({ roast: ["あ".repeat(81), "い".repeat(80)] }).roast).toHaveLength(1);
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

  it("？や～で終わる言い回しには句点を足さない", () => {
    const say = makeSpeaker(book({ accept: [{ text: "マジ？" }], reject: [{ text: "いいね～～" }], roast: [{ text: "下手！" }] }), makeRng(1), "テスト");
    expect(say("accept", "本文。")).toBe("マジ？本文。");
    // 伸ばしで終わるときは、句点の代わりに1字あける
    expect(say("reject", "本文。")).toBe("いいね～～ 本文。");
    expect(say("roast", "本文。")).toBe("下手！本文。");
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

  it("話題の合う言い回しをいちばん先に使い、合わない話題のものは使わない", () => {
    const mixed = book({ roast: [{ text: "だれでも、" }, { text: "CSの話、", topic: "lowcs" }, { text: "視界の話、", topic: "blind" }, { text: "トップ限定、", role: "TOP" }] });
    for (let seed = 0; seed < 10; seed++) {
      const say = makeSpeaker(mixed, makeRng(seed), "テスト", "TOP");
      expect(say("roast", "x", "lowcs")).toBe("CSの話、x");
      // 話題のものを使い切ったら、ロール限定 → どこでも使えるもの
      expect(say("roast", "x", "lowcs")).toBe("トップ限定、x");
      expect(say("roast", "x", "lowcs")).toBe("だれでも、x");
      expect(say("roast", "x", "lowcs")).toBe("x");
    }
  });

  it("話題を渡さない場所では、話題つきの言い回しは使わない", () => {
    const only = book({ verdictLow: [{ text: "CSの話、", topic: "lowcs" }] });
    expect(makeSpeaker(only, makeRng(1), "テスト")("verdictLow", "x")).toBe("x");
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
const BANNED_BODY = /女|男|ババア|ジジイ|デブ|ブタ|太っ|体型|体脂肪|メガネ|ブス|生え際|顔キモ|ちんちん/;
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
  });

  it("どの場所にも口ぐせがある", () => {
    for (const slot of SLOTS) expect(BUILTIN_PHRASES[slot].length, slot).toBeGreaterThan(0);
  });

  it("ロール限定の口ぐせは、そのロールのサンプルにだけ出る", () => {
    const top = /TOPレーナーとして|topレーナーじゃない/;
    const others = SAMPLE_PLAYERS.filter((s) => s.id !== "top-farmer").map((s) => text(review(s.id, BUILTIN_PHRASES)));
    for (const t of others) expect(t).not.toMatch(top);
    expect(text(review("top-farmer", BUILTIN_PHRASES))).toMatch(top);
    for (const s of SAMPLE_PLAYERS) {
      const count = text(review(s.id, BUILTIN_PHRASES)).split("最も替えたくなかったのがサポートだった。").length - 1;
      expect(count).toBe(s.id === "sup-vision" ? 1 : 0);
    }
  });

  it("話題の合う口ぐせが付く(デスの多い人にはデスの話、視界のない人にはワードの話)", () => {
    expect(text(review("mid-feeder", BUILTIN_PHRASES))).toMatch(/なんで前行ったの|仕掛けてって崩壊|何回それで死ぬ|無限に死に続ける|すごいところ入ったな|生きていれるんだ/);
    expect(text(review("adc-noward", BUILTIN_PHRASES))).toMatch(/ワード/);
    expect(text(review("top-farmer", BUILTIN_PHRASES))).toContain("ファームおいちい");
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
      [BUILTIN_PHRASES, IMAGINED_PHRASES].flatMap((book) => SLOTS.flatMap((slot) => book[slot].map((p) => p.topic))),
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

  it("話題に合うのが作った台詞だけのときは、半分くらいは実際の発言に出番をゆずる", () => {
    const mixed = book({ roast: [{ text: "実際、" }, { text: "創作の話題、", topic: "tilt", imagined: true }] });
    let imagined = 0;
    for (let seed = 0; seed < 300; seed++) if (makeSpeaker(mixed, makeRng(seed), "テスト")("roast", "x", "tilt") === "創作の話題、x") imagined += 1;
    expect(imagined).toBeGreaterThan(110);
    expect(imagined).toBeLessThan(190);
    // 話題に合う実際の発言があるときは、いつも話題が先
    const real = book({ roast: [{ text: "実際、" }, { text: "実際の話題、", topic: "tilt" }] });
    for (let seed = 0; seed < 20; seed++) expect(makeSpeaker(real, makeRng(seed), "テスト")("roast", "x", "tilt")).toBe("実際の話題、x");
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
