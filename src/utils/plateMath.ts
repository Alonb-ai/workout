import type { PlatePair, PlateLayout } from '@/types';

/**
 * Compute which plates to load on each side of a barbell to reach the
 * requested NET weight (the user's stored weight, excluding bar).
 *
 * - `requestedNet`: the weight the user wants to lift, excluding bar.
 * - `barWeight`: weight of the bar/handle (informational; never added to stored weights).
 * - `inventory`: how many plates the user OWNS, per plate weight (NOT pairs).
 * - `isMachine`: if true, no bar/plates; we just return the net as-is.
 *
 * Returns plates per side (greedy from largest), the achieved total, and the remainder.
 *
 * Algorithm: greedy descending, with one retry that skips the biggest plate when the
 * first pass misses. We work in 0.01 kg units (integer cents) to avoid FP errors.
 * Plates are placed in PAIRS. For each plate weight we have `floor(inventory/2)` usable pairs.
 */
export function computePlateLayout(args: {
  requestedNet: number;
  barWeight: number;
  inventory: PlatePair[];
  isMachine?: boolean;
}): PlateLayout {
  const { requestedNet, barWeight, inventory, isMachine = false } = args;

  if (isMachine || barWeight <= 0) {
    return {
      perSide: [],
      perSideNet: requestedNet,
      achievedTotal: requestedNet,
      requestedTotal: requestedNet,
      remainderNet: 0,
      exact: true,
      machine: true,
    };
  }

  if (requestedNet <= 0) {
    return {
      perSide: [],
      perSideNet: 0,
      achievedTotal: barWeight,
      requestedTotal: barWeight,
      remainderNet: 0,
      exact: true,
      machine: false,
    };
  }

  // Sort plates descending, in 0.01-kg integer units to avoid floating point drift.
  const cents = (x: number) => Math.round(x * 100);
  const fromCents = (x: number) => x / 100;

  const sortedPlates = [...inventory]
    .filter((p) => p.weight > 0 && p.qty >= 2)
    .map((p) => ({ weight: cents(p.weight), pairs: Math.floor(p.qty / 2) }))
    .sort((a, b) => b.weight - a.weight);

  // Greedy descending. Plates load in pairs, so we work on the TOTAL net (both sides).
  const fill = (plates: typeof sortedPlates) => {
    let left = cents(requestedNet);
    const picked: number[] = [];
    for (const plate of plates) {
      const pairWeight = plate.weight * 2; // both sides together
      if (pairWeight <= 0) continue;
      const usePairs = Math.min(Math.floor(left / pairWeight), plate.pairs);
      for (let i = 0; i < usePairs; i++) {
        picked.push(fromCents(plate.weight));
        left -= pairWeight;
      }
      if (left <= 0) break;
    }
    return { picked, left };
  };

  let best = fill(sortedPlates);
  // ponytail: one retry without the biggest plate rescues the common near-miss
  // (own 25×2 + 15×4, want 60 → 15+15 not 25). Swap in a DP if a real case escapes it.
  if (best.left > 0 && sortedPlates.length > 1) {
    const alt = fill(sortedPlates.slice(1));
    if (alt.left < best.left) best = alt;
  }
  const perSide = best.picked;
  const remaining = best.left;

  const achievedNet = cents(requestedNet) - remaining;
  const requestedTotal = fromCents(cents(requestedNet) + cents(barWeight));
  const achievedTotal = fromCents(achievedNet + cents(barWeight));
  const remainderNet = fromCents(achievedNet - cents(requestedNet)); // negative if under

  return {
    perSide,
    perSideNet: fromCents(achievedNet) / 2,
    achievedTotal,
    requestedTotal,
    remainderNet,
    exact: remaining === 0,
    machine: false,
  };
}

/** Round a weight to the nearest loadable increment given inventory (smallest pair * 2). */
export function smallestPairIncrement(inventory: PlatePair[]): number {
  const usable = inventory
    .filter((p) => p.weight > 0 && p.qty >= 2)
    .map((p) => p.weight)
    .sort((a, b) => a - b);
  return usable.length > 0 ? (usable[0] as number) * 2 : 1.25;
}
