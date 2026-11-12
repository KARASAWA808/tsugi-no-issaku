// ロールごとの採点の目安と、点数への直し方。analyze と detail の両方が使う。
import type { Role } from "./types";

/** [悪い, 良い] の組。悪い側で0点、良い側で100点 */
export type Range = readonly [number, number];

export interface Bench {
  cs: Range;
  cs10: Range;
  vision: Range;
  pinks: Range;
  kp: Range;
  dmg: Range;
  solo: Range;
  obj: Range;
}

// ロールごとの目安。厳密な統計ではなく、「ふつうなら50点前後」になるように置いた値
const LANER: Bench = {
  cs: [4.5, 8], cs10: [45, 82], vision: [0.5, 1.3], pinks: [0.5, 3],
  kp: [0.4, 0.64], dmg: [0.18, 0.31], solo: [0.2, 1.8], obj: [0.8, 3],
};
export const BENCH: Record<Role, Bench> = {
  TOP: { ...LANER, vision: [0.5, 1.2], kp: [0.32, 0.58], dmg: [0.16, 0.29], obj: [0.6, 2.6] },
  JUNGLE: {
    cs: [3.8, 6.6], cs10: [40, 68], vision: [0.7, 1.5], pinks: [1, 4],
    kp: [0.45, 0.7], dmg: [0.12, 0.24], solo: [0.1, 1.2], obj: [1.5, 4.5],
  },
  MIDDLE: LANER,
  BOTTOM: { ...LANER, cs: [5, 8.5], cs10: [48, 82], vision: [0.5, 1.2], dmg: [0.19, 0.33], solo: [0.05, 0.9], obj: [0.8, 3.2] },
  // サポートはCSを見ない(cs / cs10 は使わない)
  UTILITY: {
    cs: [0, 1], cs10: [0, 1], vision: [1.5, 3], pinks: [2, 6],
    kp: [0.45, 0.7], dmg: [0.05, 0.15], solo: [0, 0.5], obj: [0.8, 3],
  },
  UNKNOWN: LANER,
};

/** bad で0、good で100 になるように直線で点数にする。bad > good(小さいほど良い項目)でも使える */
export function scale(value: number, [bad, good]: Range): number {
  const t = (value - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

