import type { BodyMeasurement, PhotoPose } from '@/types';

/** Tape-measure fields, in the order the form and the chart chips show them. */
export type CircumferenceKey = 'waistCm' | 'chestCm' | 'armCm' | 'thighCm' | 'hipsCm';

export const CIRCUMFERENCES: { key: CircumferenceKey; label: string; hint: string }[] = [
  { key: 'waistCm', label: 'מותניים', hint: 'בגובה הטבור' },
  { key: 'chestCm', label: 'חזה', hint: 'בגובה הפטמות' },
  { key: 'armCm', label: 'זרוע', hint: 'כפופה, בנקודה הרחבה' },
  { key: 'thighCm', label: 'ירך', hint: 'בנקודה הרחבה' },
  { key: 'hipsCm', label: 'אגן', hint: 'בנקודה הרחבה' },
];

/** Plausible adult range per field. Out of range is refused, never clamped. */
export const CIRCUMFERENCE_RANGE: Record<CircumferenceKey, [number, number]> = {
  waistCm: [40, 200],
  chestCm: [50, 200],
  armCm: [15, 70],
  thighCm: [25, 110],
  hipsCm: [50, 200],
};

export const POSES: { key: PhotoPose; label: string }[] = [
  { key: 'front', label: 'חזית' },
  { key: 'side', label: 'צד' },
  { key: 'back', label: 'גב' },
];

/** Measurements that carry at least one photo, oldest first. */
export function withPhotos(list: BodyMeasurement[]): BodyMeasurement[] {
  return list.filter((m) => (m.photos?.length ?? 0) > 0);
}

/** First → last change of a circumference across the list, or null. */
export function circumferenceChange(
  list: BodyMeasurement[],
  key: CircumferenceKey,
): { first: number; last: number; delta: number; count: number } | null {
  const vals = list.map((m) => m[key]).filter((v): v is number => v !== undefined);
  if (vals.length === 0) return null;
  const first = vals[0]!;
  const last = vals[vals.length - 1]!;
  return { first, last, delta: Math.round((last - first) * 10) / 10, count: vals.length };
}
