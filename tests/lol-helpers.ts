// lol のテストで使う、手作りの試合データ。
import type { MatchStat, MatchTimeline, PlayerData } from "../lol/src/types";

export function timeline(over: Partial<MatchTimeline> = {}): MatchTimeline {
  return { goldDiff10: 100, goldDiff15: 200, csDiff10: 2, takedowns10: 1, deathMinutes: [8.5, 14.2, 19.9, 24.1, 28.4], soloDeaths: 1, deepDeaths: 1, ...over };
}

/** ごくふつうのミッドの1試合。変えたいところだけ上書きする */
export function match(over: Partial<MatchStat> = {}): MatchStat {
  return {
    matchId: "T_1", queueId: 420, gameStart: 1_700_000_000_000, durationSec: 1800, win: true, role: "MIDDLE", champion: "Ahri",
    kills: 6, deaths: 5, assists: 7, cs: 190, gold: 11500, damage: 22000, damageTaken: 18000,
    visionScore: 27, wardsPlaced: 10, wardsKilled: 3, controlWards: 2, teamKills: 25, teamDamage: 90000,
    firstBlood: false, soloKills: 1, csAt10: 64, objectives: 2, turretTakedowns: 2, largestMultiKill: 2, timeDeadSec: 180,
    side: "blue", level: 15, csDiff: 5, goldDiff: 300, damageDiff: 1000, laneWon: null, turretPlates: 1,
    objectiveDamage: 6000, teamObjectives: 4, healShield: 500, ccSec: 15, skillshotsDodged: 30, epicSteals: 0,
    pings: 30, missingPings: 2, surrendered: false, longestLivingSec: 600, timeline: timeline(),
    ...over,
  };
}

export function player(matches: MatchStat[], over: Partial<PlayerData> = {}): PlayerData {
  return { gameName: "テスト", tagLine: "TEST", level: 100, rank: null, matches, ...over };
}

/** 1試合ごとに時刻をずらした試合の列(新しい順)。gapMinutes は「前の試合が終わってから次を始めるまで」 */
export function series(overs: Partial<MatchStat>[], gapMinutes = 180): MatchStat[] {
  const oldestFirst: MatchStat[] = [];
  let start = 1_700_000_000_000;
  for (const [i, over] of [...overs].reverse().entries()) {
    const m = match({ matchId: `T_${i}`, ...over, gameStart: over.gameStart ?? start });
    oldestFirst.push(m);
    start = m.gameStart + m.durationSec * 1000 + gapMinutes * 60 * 1000;
  }
  return oldestFirst.reverse();
}
