/**
 * Warm-up ramp for a working weight.
 *
 * Weights in and out are NET (plates / stack only), like everywhere else in the
 * app. The percentages are taken of the TOTAL load the body moves (net + bar),
 * because that is what the ramp is warming up for, and converted back to net
 * at the end. A 60 kg net squat on a 20 kg bar ramps toward 80 kg, not 60.
 */

export interface WarmupSet {
  /** Net weight: 0 means the empty bar (or bodyweight / lightest pin). */
  weight: number;
  reps: number;
}

interface Step {
  pct: number;
  reps: number;
}

/** Barbell: empty bar, then three climbs. */
const BARBELL_STEPS: Step[] = [
  { pct: 0, reps: 10 },
  { pct: 0.4, reps: 8 },
  { pct: 0.6, reps: 5 },
  { pct: 0.8, reps: 3 },
];

/** Machines, dumbbells, cables: two feeler sets are enough. */
const OTHER_STEPS: Step[] = [
  { pct: 0.5, reps: 10 },
  { pct: 0.75, reps: 5 },
];

/** Below this net working weight a non-barbell lift needs no ramp at all. */
const LIGHT_NET_KG = 10;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Round DOWN to a loadable step — a warm-up must never overshoot. */
function floorTo(weight: number, step: number): number {
  if (step <= 0) return round2(weight);
  // The epsilon absorbs float noise (0.6 * 50 = 29.999999…).
  return round2(Math.floor(weight / step + 1e-9) * step);
}

export function warmupSets(args: {
  /** Net working weight. */
  workWeight: number;
  barWeight: number;
  isMachine: boolean;
  /** Loading step, as resolved for progression (`resolveIncrement`). */
  increment: number;
}): WarmupSet[] {
  const { workWeight, barWeight, isMachine, increment } = args;
  if (!(workWeight > 0)) return [];

  const barbell = !isMachine && barWeight > 0;
  if (!barbell && workWeight <= LIGHT_NET_KG) return [];

  const bar = barbell ? barWeight : 0;
  const total = workWeight + bar;
  const steps = barbell ? BARBELL_STEPS : OTHER_STEPS;

  const out: WarmupSet[] = [];
  for (const step of steps) {
    const net = step.pct === 0 ? 0 : floorTo(step.pct * total - bar, increment);
    if (net < 0) continue;
    // Each set must climb, and none may reach the working weight itself.
    const prev = out[out.length - 1];
    if (prev && net <= prev.weight) continue;
    if (net >= workWeight) continue;
    if (step.pct > 0 && net === 0) continue;
    out.push({ weight: net, reps: step.reps });
  }
  return out;
}
