// APIキーなしでも遊べるようにする内蔵サンプル。全員が架空のプレイヤーで、数値は種つき乱数から毎回同じものを作る。
import type { MatchStat, PlayerData, RankInfo, Role } from "./types";

const MATCHES = 20;
/** いちばん新しい試合の開始時刻。固定なので、いつ呼んでも同じ結果になる */
const NEWEST_START = Date.UTC(2026, 10, 8, 13, 40, 0);

/** 1試合の数値を決める傾向。値はおおよそ30分の試合での平均 */
interface Profile {
  /** キル関与率 */
  kp: number;
  /** キル+アシストのうちキルの割合 */
  killFrac: number;
  deaths: number;
  csPerMin: number;
  csAt10: number;
  /** CS・キル以外で入る1分あたりのゴールド */
  baseGpm: number;
  /** チームの与ダメージに占める割合 */
  dmgShare: number;
  takenPerMin: number;
  visionPerMin: number;
  wardsPerMin: number;
  wardKillsPerMin: number;
  controlWards: number;
  /** キルのうちソロキルの割合 */
  soloFrac: number;
  /** マルチキルの出やすさ(1が標準) */
  multi: number;
  /** ファーストブラッドに絡む確率 */
  firstBlood: number;
  objectives: number;
  turrets: number;
}

interface Archetype {
  id: string;
  label: string;
  blurb: string;
  gameName: string;
  level: number;
  rank: RankInfo;
  seed: number;
  /** 20試合中の勝ち数 */
  wins: number;
  /** フレックス(440)とノーマル(400)の試合数。残りはソロ/デュオ(420) */
  flex: number;
  normal: number;
  /** 10分CSが取れなかった扱いにする試合数 */
  noCsAt10: number;
  role: Role;
  /** メインロールで使うチャンピオンと試合数 */
  champions: [champion: string, games: number][];
  /** メイン以外のロールで出た試合(各1試合) */
  offRole: { role: Role; champion: string; tweak: Partial<Profile> }[];
  profile: Profile;
}

const ARCHETYPES: Archetype[] = [
  {
    id: "mid-feeder",
    label: "デスの多い突撃ミッド",
    blurb: "キルは取るが、それ以上に倒されているミッドレーナー。",
    gameName: "さんぷる突撃ミッド",
    level: 187,
    rank: { tier: "BRONZE", division: "II", lp: 34, wins: 88, losses: 104 },
    seed: 0x51a7e001,
    wins: 8,
    flex: 2,
    normal: 3,
    noCsAt10: 1,
    role: "MIDDLE",
    champions: [["Yasuo", 9], ["Yone", 4], ["Katarina", 3], ["Zed", 2]],
    offRole: [
      { role: "TOP", champion: "Yasuo", tweak: { csPerMin: 5.9, csAt10: 54 } },
      { role: "TOP", champion: "Yone", tweak: { csPerMin: 5.9, csAt10: 54 } },
    ],
    profile: {
      kp: 0.47, killFrac: 0.62, deaths: 9.6,
      csPerMin: 6.2, csAt10: 57, baseGpm: 125,
      dmgShare: 0.27, takenPerMin: 720,
      visionPerMin: 0.58, wardsPerMin: 0.22, wardKillsPerMin: 0.04, controlWards: 0.6,
      soloFrac: 0.4, multi: 1.2, firstBlood: 0.4, objectives: 1.1, turrets: 1.3,
    },
  },
  {
    id: "top-farmer",
    label: "ファームだけ上手いトップ",
    blurb: "CSは一流、でも集団戦には来ないトップレーナー。",
    gameName: "サンプル農家トップ",
    level: 264,
    rank: { tier: "GOLD", division: "IV", lp: 12, wins: 132, losses: 129 },
    seed: 0x51a7e002,
    wins: 9,
    flex: 1,
    normal: 2,
    noCsAt10: 2,
    role: "TOP",
    champions: [["Nasus", 10], ["Garen", 5], ["Tryndamere", 4]],
    offRole: [{ role: "MIDDLE", champion: "Garen", tweak: { csPerMin: 7.9, csAt10: 76 } }],
    profile: {
      kp: 0.29, killFrac: 0.55, deaths: 3.9,
      csPerMin: 8.5, csAt10: 83, baseGpm: 168,
      dmgShare: 0.18, takenPerMin: 880,
      visionPerMin: 0.78, wardsPerMin: 0.3, wardKillsPerMin: 0.05, controlWards: 1.2,
      soloFrac: 0.45, multi: 0.6, firstBlood: 0.08, objectives: 0.6, turrets: 3.3,
    },
  },
  {
    id: "adc-noward",
    label: "ワードを置かないADC",
    blurb: "火力は出すが、視界はすべて味方まかせのADC。",
    gameName: "さんぷるADC",
    level: 143,
    rank: { tier: "SILVER", division: "I", lp: 71, wins: 77, losses: 75 },
    seed: 0x51a7e003,
    wins: 10,
    flex: 3,
    normal: 2,
    noCsAt10: 1,
    role: "BOTTOM",
    champions: [["Jinx", 8], ["MissFortune", 5], ["Kaisa", 3], ["Ezreal", 2]],
    offRole: [
      { role: "MIDDLE", champion: "Ezreal", tweak: { csPerMin: 6.7, csAt10: 62 } },
      {
        role: "UTILITY", champion: "MissFortune",
        tweak: { csPerMin: 1.3, csAt10: 12, baseGpm: 215, dmgShare: 0.2, killFrac: 0.3, visionPerMin: 0.62, wardsPerMin: 0.3 },
      },
    ],
    profile: {
      kp: 0.55, killFrac: 0.52, deaths: 6.1,
      csPerMin: 7.3, csAt10: 68, baseGpm: 128,
      dmgShare: 0.29, takenPerMin: 520,
      visionPerMin: 0.47, wardsPerMin: 0.12, wardKillsPerMin: 0.02, controlWards: 0.1,
      soloFrac: 0.12, multi: 1.4, firstBlood: 0.2, objectives: 2, turrets: 2.6,
    },
  },
  {
    id: "sup-vision",
    label: "視界は完璧だがダメージの出ないサポート",
    blurb: "ワードは完璧、でも敵のHPはほとんど減らないサポート。",
    gameName: "サンプル視界サポ",
    level: 231,
    rank: { tier: "GOLD", division: "II", lp: 45, wins: 101, losses: 93 },
    seed: 0x51a7e004,
    wins: 11,
    flex: 4,
    normal: 1,
    noCsAt10: 1,
    role: "UTILITY",
    champions: [["Thresh", 7], ["Janna", 5], ["Lulu", 4], ["Nautilus", 3]],
    offRole: [
      {
        role: "MIDDLE", champion: "Lux",
        tweak: {
          csPerMin: 5.6, csAt10: 52, baseGpm: 120, dmgShare: 0.2, killFrac: 0.35, kp: 0.5,
          visionPerMin: 1.5, wardsPerMin: 0.6, wardKillsPerMin: 0.15, controlWards: 3,
        },
      },
    ],
    profile: {
      kp: 0.63, killFrac: 0.06, deaths: 4.6,
      csPerMin: 0.95, csAt10: 9, baseGpm: 228,
      dmgShare: 0.108, takenPerMin: 480,
      visionPerMin: 2.7, wardsPerMin: 1.3, wardKillsPerMin: 0.4, controlWards: 5.5,
      soloFrac: 0.05, multi: 0.3, firstBlood: 0.22, objectives: 2.3, turrets: 1.5,
    },
  },
  {
    id: "jg-solid",
    label: "何でもそつなくこなす高勝率ジャングル",
    blurb: "オブジェクトも視界も抜かりなく、勝率の高いジャングラー。",
    gameName: "さんぷる万能JG",
    level: 312,
    rank: { tier: "PLATINUM", division: "III", lp: 58, wins: 96, losses: 71 },
    seed: 0x51a7e005,
    wins: 13,
    flex: 2,
    normal: 1,
    noCsAt10: 1,
    role: "JUNGLE",
    champions: [["LeeSin", 6], ["Vi", 5], ["Viego", 4], ["Sejuani", 3]],
    offRole: [
      { role: "TOP", champion: "Garen", tweak: { csPerMin: 7.1, csAt10: 71, objectives: 1.6, turrets: 2.4, kp: 0.52 } },
      {
        role: "UTILITY", champion: "Nautilus",
        tweak: {
          csPerMin: 1, csAt10: 10, baseGpm: 225, dmgShare: 0.12, killFrac: 0.15,
          visionPerMin: 2.2, wardsPerMin: 1.05, wardKillsPerMin: 0.3, controlWards: 4.5, objectives: 2.5,
        },
      },
    ],
    profile: {
      kp: 0.67, killFrac: 0.4, deaths: 4.4,
      csPerMin: 5.8, csAt10: 62, baseGpm: 140,
      dmgShare: 0.2, takenPerMin: 930,
      visionPerMin: 1.4, wardsPerMin: 0.45, wardKillsPerMin: 0.2, controlWards: 3,
      soloFrac: 0.18, multi: 1, firstBlood: 0.35, objectives: 4, turrets: 1.9,
    },
  },
];

export const SAMPLE_PLAYERS: { id: string; label: string; blurb: string }[] = ARCHETYPES.map(
  ({ id, label, blurb }) => ({ id, label, blurb }),
);

type Rng = () => number;

/** 種つきの乱数(mulberry32)。同じ種なら同じ列になる */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
/** 1 を中心に ±spread でゆらす(中央に寄る) */
const vary = (rng: Rng, spread: number) => 1 + (rng() + rng() - 1) * spread;
const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);

function shuffle<T>(rng: Rng, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** マルチキルの段階ごとの、必要キル数と出る確率 */
const MULTI_STEPS: [kills: number, chance: number][] = [[2, 0.5], [4, 0.22], [7, 0.15], [10, 0.2]];

type Played = Omit<MatchStat, "matchId" | "queueId" | "gameStart" | "role" | "champion">;

/** 傾向と勝敗から1試合ぶんの数値を作る。チームの数値を先に決めて、本人の分をそこから切り出す */
function play(rng: Rng, p: Profile, win: boolean, withCsAt10: boolean): Played {
  const durationSec = Math.round(1200 + ((rng() + rng()) / 2) * 1200);
  const minutes = durationSec / 60;
  const length = minutes / 30;

  const teamKills = Math.max(6, Math.round((win ? 31 : 22) * length ** 0.8 * vary(rng, 0.25)));
  const involved = Math.round(teamKills * clamp(p.kp + (win ? 0.02 : -0.02) + (vary(rng, 0.09) - 1), 0.12, 0.9));
  const kills = Math.round(involved * clamp(p.killFrac * vary(rng, 0.3), 0, 1));
  const assists = involved - kills;
  const deaths = clamp(Math.round(p.deaths * (win ? 0.8 : 1.18) * length ** 0.8 * vary(rng, 0.4)), 0, 17);

  const cs = Math.round(p.csPerMin * minutes * (win ? 1.03 : 0.97) * vary(rng, 0.08));
  const csAt10 = Math.min(cs, Math.round(p.csAt10 * vary(rng, 0.12)));
  const turretTakedowns = clamp(Math.round(p.turrets * (win ? 1.4 : 0.6) * vary(rng, 0.5)), 0, 6);
  const objectives = clamp(Math.round(p.objectives * (win ? 1.25 : 0.7) * vary(rng, 0.5)), 0, 6);
  const earned = (p.baseGpm * minutes + cs * 21 + kills * 300 + assists * 120 + turretTakedowns * 120) * vary(rng, 0.04);
  const gold = Math.round(clamp(earned, 300 * minutes, 480 * minutes));

  const teamDamage = Math.round(between(rng, 2600, 3400) * minutes * (win ? 1.04 : 0.97));
  const damage = Math.round(teamDamage * clamp(p.dmgShare + (vary(rng, 0.045) - 1), 0.102, 0.348));
  const damageTaken = Math.round(p.takenPerMin * minutes * vary(rng, 0.2) + deaths * 700);

  const visionScore = Math.round(clamp(p.visionPerMin * vary(rng, 0.15), 0.43, 2.97) * minutes);
  const wardsPlaced = Math.round(p.wardsPerMin * minutes * vary(rng, 0.25));
  const wardsKilled = Math.round(p.wardKillsPerMin * minutes * vary(rng, 0.6));
  const controlWards = clamp(Math.round(p.controlWards * length * vary(rng, 0.45)), 0, 8);

  const soloKills = Math.min(kills, Math.round(kills * p.soloFrac * vary(rng, 0.6)));
  let largestMultiKill = Math.min(kills, 1);
  for (const [need, chance] of MULTI_STEPS) {
    if (kills < need || rng() >= chance * p.multi) break;
    largestMultiKill++;
  }
  const firstBlood = rng() < p.firstBlood && involved > 0;
  // 1デスあたりの待ち時間は試合が長いほど延びる
  const deadPerDeath = clamp(24 + (minutes - 20) * 0.9 + rng() * 5, 25, 45);
  const timeDeadSec = Math.round(deaths * deadPerDeath);

  return {
    durationSec, win, kills, deaths, assists, cs, gold, damage, damageTaken,
    visionScore, wardsPlaced, wardsKilled, controlWards, teamKills, teamDamage,
    firstBlood, soloKills, csAt10: withCsAt10 ? csAt10 : null,
    objectives, turretTakedowns, largestMultiKill, timeDeadSec,
  };
}

/** 前の試合が終わってから次を始めるまで。続けて回す日と、日をまたぐ日がある */
function breakMs(rng: Rng): number {
  const minutes = rng() < 0.55 ? between(rng, 4, 12) : between(rng, 10, 30) * 60;
  return Math.round(minutes * 60) * 1000;
}

function buildMatches(a: Archetype, base: number): MatchStat[] {
  const rng = mulberry32(a.seed);
  const slots = shuffle(rng, [
    ...a.champions.flatMap(([champion, games]) =>
      Array.from({ length: games }, () => ({ role: a.role, champion, profile: a.profile })),
    ),
    ...a.offRole.map((o) => ({ role: o.role, champion: o.champion, profile: { ...a.profile, ...o.tweak } })),
  ]);
  // 勝敗・キュー・10分CSなしは、数を決めてから並びだけ混ぜる
  const wins = shuffle(rng, slots.map((_, i) => i < a.wins));
  const queues = shuffle(rng, slots.map((_, i) => (i < a.flex ? 440 : i < a.flex + a.normal ? 400 : 420)));
  const noCsAt10 = shuffle(rng, slots.map((_, i) => i < a.noCsAt10));

  let gameStart = NEWEST_START;
  return slots.map((slot, i) => {
    const played = play(rng, slot.profile, wins[i], !noCsAt10[i]);
    // 新しい順に作るので、古い試合ほど前へさかのぼる
    if (i > 0) gameStart -= played.durationSec * 1000 + breakMs(rng);
    return {
      matchId: `DEMO_${base + slots.length - i}`,
      queueId: queues[i],
      gameStart,
      role: slot.role,
      champion: slot.champion,
      ...played,
    };
  });
}

/** サンプルのプレイヤーを返す。知らない id なら null */
export function samplePlayer(id: string): PlayerData | null {
  const index = ARCHETYPES.findIndex((a) => a.id === id);
  if (index < 0) return null;
  const a = ARCHETYPES[index];
  const matches = buildMatches(a, (index + 1) * 1000);
  if (matches.length !== MATCHES) throw new Error(`サンプル ${id} の試合数が ${MATCHES} ではありません`);
  return {
    gameName: a.gameName,
    tagLine: "DEMO",
    level: a.level,
    rank: { ...a.rank },
    matches,
    sample: true,
  };
}
