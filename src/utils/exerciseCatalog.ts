import type { MuscleTag } from '@/types';

/**
 * Muscle knowledge for "similar exercise" suggestions.
 *
 * Exercise names are free text (mostly Hebrew, some English), so muscles are
 * GUESSED from the name plus the muscle-group label the exercise sits under.
 * The user can override the guess per exercise (`Exercise.muscles`). Pure
 * functions only — no Dexie here.
 */

export const MUSCLE_LABEL: Record<MuscleTag, string> = {
  chest: 'חזה',
  frontDelts: 'כתף קדמית',
  sideDelts: 'כתף צידית',
  rearDelts: 'כתף אחורית',
  triceps: 'יד אחורית',
  lats: 'גב רחב',
  upperBack: 'גב עליון',
  biceps: 'יד קדמית',
  forearms: 'אמות',
  quads: 'ארבע ראשי',
  hamstrings: 'ירך אחורית',
  glutes: 'ישבן',
  adductors: 'מקרבים',
  calves: 'שוקיים',
  abs: 'בטן',
  lowerBack: 'גב תחתון',
};

export const ALL_MUSCLES = Object.keys(MUSCLE_LABEL) as MuscleTag[];

type Rule = { re: RegExp; tags: MuscleTag[]; not?: RegExp };

/**
 * Note: `\b` is ASCII-only in JS regexes, so Hebrew words are bounded with
 * `(^|\s)…($|\s)` instead.
 *
 * Ordered from most to least specific. The FIRST matching rule's first tag is
 * treated as the primary muscle; later rules only add secondary tags. Leg
 * curls must be caught before the generic "curl → biceps" rule.
 */
const NAME_RULES: Rule[] = [
  { re: /leg curl|כפיפ(ת|ות) ברכ|האמסטרינג|המסטרינג|ירך אחורית|hamstring|nordic/, tags: ['hamstrings'] },
  { re: /\brdl\b|רומני|romanian|stiff|good ?morning/, tags: ['hamstrings', 'glutes', 'lowerBack'] },
  { re: /deadlift|דדליפט|מתים/, tags: ['hamstrings', 'glutes', 'lowerBack', 'upperBack'] },
  { re: /hip thrust|גשר|ישבן|glute|kickback|קיקבק|אבדוקש|abduct/, tags: ['glutes', 'hamstrings'] },
  { re: /adduct|מקרב/, tags: ['adductors'] },
  { re: /שוקיים|(^|\s)שוק($|\s)|calf|calves/, tags: ['calves'] },
  { re: /האק|hack|סקוואט|squat|לחיצת רגליים|leg press|בולגרי|bulgarian/, tags: ['quads', 'glutes'] },
  { re: /לאנץ|לאנג|lunge|step ?up|עליה לספסל/, tags: ['quads', 'glutes'] },
  { re: /ארבע[- ]?ראשי|leg extension|פשיטת ברכ|quad/, tags: ['quads'] },
  { re: /גב תחתון|אקסטנשן|extension גב|hyperext|back ext|סופרמן/, tags: ['lowerBack', 'glutes'] },
  { re: /בטן|\babs?\b|crunch|כפיפות בטן|אולר|פנגווין|הנפות רגליים|leg raise|plank|פלאנק|wheel|גלגלת/, tags: ['abs'], not: /על הבטן|חתיר|\brow/ },
  { re: /face ?pull|פייס|לכיוון הפנים|rear delt|כתף אחורית|פרפר הפוך|reverse fly|reverse pec/, tags: ['rearDelts', 'upperBack'] },
  { re: /lateral|הנפ(ה|ות) (ל)?צד|צידית|לצד|כתפיים לצד|upright|חתירה אנכית/, tags: ['sideDelts'] },
  { re: /overhead press|\bohp\b|military|לחיצת כתפיים|לחיצת כתף|shoulder press|arnold|ארנולד/, tags: ['frontDelts', 'sideDelts', 'triceps'] },
  { re: /front raise|הנפה (ל)?קדימה/, tags: ['frontDelts'] },
  { re: /מקבילים|\bdips?\b/, tags: ['chest', 'triceps', 'frontDelts'] },
  { re: /close ?grip|אחיזה צרה/, tags: ['triceps', 'chest'] },
  { re: /יד אחורית|טריצפס|tricep|pushdown|push ?down|skull|פשיטת מרפק|french|צרפתי/, tags: ['triceps'] },
  { re: /פרפר|\bfly\b|flye|crossover|קרוסאובר|pec deck|פק דק/, tags: ['chest', 'frontDelts'] },
  { re: /בנץ|bench|לחיצת חזה|chest press|לחיצת פלטה|שכיבות סמיכה|push ?up|חזה/, tags: ['chest', 'frontDelts', 'triceps'] },
  { re: /פולי|pulldown|pull ?down|מתח|pull ?up|chin|רוחב|כנפיים|straight arm|pullover|פולאובר/, tags: ['lats', 'biceps'] },
  { re: /חתיר|\brow\b|rows|t-?bar|דבליו|שכמות|גב[- ]?עומק|shrug|שראג/, tags: ['upperBack', 'lats', 'biceps'] },
  { re: /פטיש|hammer|ברכיאליס|בריכיאליס|brachialis|reverse curl/, tags: ['biceps', 'forearms'] },
  { re: /יד קדמית|ביצפס|bicep|curl|כפיפת מרפק|preacher|כומר/, tags: ['biceps'], not: /leg|רגל|ברכ/ },
  { re: /אמות|forearm|wrist|שורש כף|farmer|הליכת חקלאי|אחיזה/, tags: ['forearms'] },
  { re: /כתפ|כתף|shoulder|delt/, tags: ['frontDelts', 'sideDelts'] },
  { re: /(^|\s)גב($|\s)|back/, tags: ['lats', 'upperBack'], not: /תחתון|lower|ext/ },
  { re: /רגליים|legs?\b/, tags: ['quads', 'glutes', 'hamstrings'], not: /הנפ|raise|curl|כפיפ/ },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[׳'"`’]/g, '')
    .replace(/[-–—_/·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchRules(text: string): MuscleTag[] {
  const t = norm(text);
  const out: MuscleTag[] = [];
  for (const rule of NAME_RULES) {
    if (!rule.re.test(t)) continue;
    if (rule.not && rule.not.test(t)) continue;
    for (const tag of rule.tags) if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * Muscles an exercise trains, primary first. Name wins; the muscle-group label
 * only fills in when the name says nothing ("מכונה 3" under "חזה").
 */
export function inferMuscles(ex: {
  name: string;
  muscles?: MuscleTag[];
  groupName?: string;
}): MuscleTag[] {
  if (ex.muscles && ex.muscles.length > 0) return ex.muscles;
  const fromName = matchRules(ex.name);
  if (fromName.length > 0) return fromName;
  return ex.groupName ? matchRules(ex.groupName) : [];
}

/** Rough equipment class from the name, used only to break ties. */
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'other';

export function inferEquipment(ex: { name: string; isMachine?: boolean }): Equipment {
  const n = norm(ex.name);
  if (/כבל|cable/.test(n)) return 'cable';
  if (ex.isMachine || /מכונ|machine|סמית|smith|האק|hack|לחיצת רגליים|leg press|פולי|pec deck/.test(n)) return 'machine';
  if (/דמבל|dumbbell|\bdb\b|פטישים/.test(n)) return 'dumbbell';
  if (/מוט|barbell|בנץ|bench|סקוואט|squat|דדליפט|deadlift|\bez\b/.test(n)) return 'barbell';
  if (/מתח|pull ?up|chin|מקבילים|dips?|שכיבות|push ?up|משקל גוף|bodyweight|בלי משקל/.test(n)) return 'bodyweight';
  return 'other';
}

/**
 * Similarity 0–100 between two exercises' muscle profiles.
 * Same primary muscle dominates; shared secondaries add a little; same
 * equipment breaks ties. Two exercises with no known muscles score 0.
 */
export function similarity(
  a: { muscles: MuscleTag[]; equipment: Equipment },
  b: { muscles: MuscleTag[]; equipment: Equipment },
): number {
  if (a.muscles.length === 0 || b.muscles.length === 0) return 0;
  let score = 0;
  if (a.muscles[0] === b.muscles[0]) score += 60;
  else if (b.muscles.includes(a.muscles[0]!)) score += 20;
  else if (a.muscles.includes(b.muscles[0]!)) score += 15;
  const shared = a.muscles.filter((m) => b.muscles.includes(m)).length;
  const union = new Set([...a.muscles, ...b.muscles]).size;
  score += Math.round((shared / union) * 30);
  if (score > 0 && a.equipment === b.equipment) score += 10;
  return Math.min(100, score);
}

// ============================================================================
// Built-in catalog — suggestions for exercises the user does not have yet.
// ============================================================================

export interface CatalogExercise {
  name: string;
  muscles: MuscleTag[];
  isMachine?: boolean;
  repsMin: number;
  repsMax: number;
}

const C = (
  name: string,
  muscles: MuscleTag[],
  repsMin: number,
  repsMax: number,
  isMachine = false,
): CatalogExercise => ({ name, muscles, repsMin, repsMax, ...(isMachine ? { isMachine } : {}) });

export const EXERCISE_CATALOG: CatalogExercise[] = [
  // Chest
  C('לחיצת חזה במוט', ['chest', 'frontDelts', 'triceps'], 4, 8),
  C('לחיצת חזה בשיפוע חיובי במוט', ['chest', 'frontDelts', 'triceps'], 6, 10),
  C('לחיצת חזה דמבלים', ['chest', 'frontDelts', 'triceps'], 6, 10),
  C('לחיצת חזה בשיפוע דמבל', ['chest', 'frontDelts', 'triceps'], 6, 10),
  C('לחיצת חזה במכונה', ['chest', 'frontDelts', 'triceps'], 8, 12, true),
  C('לחיצת חזה בסמית׳', ['chest', 'frontDelts', 'triceps'], 6, 10, true),
  C('פרפר במכונה', ['chest', 'frontDelts'], 10, 15, true),
  C('קרוסאובר בכבלים', ['chest', 'frontDelts'], 10, 15),
  C('מקבילים', ['chest', 'triceps', 'frontDelts'], 6, 12),
  C('שכיבות סמיכה', ['chest', 'triceps', 'frontDelts'], 10, 20),
  // Shoulders
  C('לחיצת כתפיים במוט', ['frontDelts', 'sideDelts', 'triceps'], 4, 8),
  C('לחיצת כתפיים דמבלים', ['frontDelts', 'sideDelts', 'triceps'], 6, 10),
  C('לחיצת כתפיים במכונה', ['frontDelts', 'sideDelts', 'triceps'], 8, 12, true),
  C('הנפה לצד דמבלים', ['sideDelts'], 10, 15),
  C('הנפה לצד בכבל', ['sideDelts'], 10, 15),
  C('הנפה לצד במכונה', ['sideDelts'], 10, 15, true),
  C('פייס פול בכבל', ['rearDelts', 'upperBack'], 12, 15),
  C('פרפר הפוך במכונה', ['rearDelts', 'upperBack'], 10, 15, true),
  // Triceps
  C('פשיטת מרפקים בכבל (פושדאון)', ['triceps'], 8, 12),
  C('פשיטת מרפקים מעל הראש בכבל', ['triceps'], 8, 12),
  C('לחיצה צרפתית', ['triceps'], 8, 12),
  C('לחיצת חזה באחיזה צרה', ['triceps', 'chest'], 6, 10),
  C('מקבילים במכונה', ['triceps', 'chest'], 8, 12, true),
  // Back
  C('מתח', ['lats', 'biceps'], 4, 10),
  C('פולי עליון אחיזה רחבה', ['lats', 'biceps'], 8, 12, true),
  C('פולי עליון אחיזה צרה', ['lats', 'biceps'], 8, 12, true),
  C('פולאובר בכבל ידיים ישרות', ['lats'], 10, 15),
  C('חתירה במוט', ['upperBack', 'lats', 'biceps'], 6, 10),
  C('חתירה בדמבל יד אחת', ['upperBack', 'lats', 'biceps'], 8, 12),
  C('חתירה בכבל בישיבה', ['upperBack', 'lats', 'biceps'], 8, 12),
  C('חתירה במכונה', ['upperBack', 'lats', 'biceps'], 8, 12, true),
  C('חתירת T-bar', ['upperBack', 'lats', 'biceps'], 6, 10),
  C('חתירה בשכיבה על ספסל משופע', ['upperBack', 'lats', 'biceps'], 8, 12),
  // Biceps / forearms
  C('כפיפת מרפקים במוט', ['biceps'], 6, 10),
  C('כפיפת מרפקים דמבלים', ['biceps'], 8, 12),
  C('כפיפת מרפקים בכבל', ['biceps'], 10, 15),
  C('כפיפת מרפקים על ספסל כומר', ['biceps'], 8, 12),
  C('פטישים דמבלים', ['biceps', 'forearms'], 8, 12),
  C('כפיפת מרפקים בשיפוע דמבלים', ['biceps'], 8, 12),
  // Quads
  C('סקוואט במוט', ['quads', 'glutes'], 4, 8),
  C('סקוואט קדמי', ['quads', 'glutes'], 4, 8),
  C('האק סקוואט במכונה', ['quads', 'glutes'], 6, 10, true),
  C('לחיצת רגליים', ['quads', 'glutes'], 8, 12, true),
  C('סקוואט בולגרי', ['quads', 'glutes'], 8, 12),
  C('לאנג׳ים עם דמבלים', ['quads', 'glutes'], 8, 12),
  C('פשיטת ברכיים במכונה', ['quads'], 10, 15, true),
  // Hamstrings / glutes
  C('דדליפט רומני (RDL)', ['hamstrings', 'glutes', 'lowerBack'], 6, 10),
  C('כפיפת ברכיים בשכיבה במכונה', ['hamstrings'], 8, 12, true),
  C('כפיפת ברכיים בישיבה במכונה', ['hamstrings'], 8, 12, true),
  C('היפ ת׳ראסט', ['glutes', 'hamstrings'], 8, 12),
  C('גב תחתון אקסטנשן', ['lowerBack', 'glutes', 'hamstrings'], 10, 15),
  C('מכונת מקרבים', ['adductors'], 10, 15, true),
  // Calves
  C('שוקיים בעמידה במכונה', ['calves'], 10, 15, true),
  C('שוקיים בישיבה במכונה', ['calves'], 12, 15, true),
  C('שוקיים בלחיצת רגליים', ['calves'], 12, 15, true),
  // Abs
  C('כפיפות בטן בכבל', ['abs'], 10, 15),
  C('הנפות רגליים בתלייה', ['abs'], 8, 15),
  C('בטן במכונה', ['abs'], 10, 15, true),
  C('גלגלת בטן', ['abs'], 8, 15),
];

/** Name comparison that ignores case, punctuation and geresh variants. */
export function sameExerciseName(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

export interface SimilarCandidate<T> {
  item: T;
  score: number;
}

/**
 * Rank candidates by similarity to `target`. Candidates scoring below
 * `minScore` are dropped (they share no meaningful muscle).
 */
export function rankSimilar<T>(
  target: { name: string; muscles?: MuscleTag[]; groupName?: string; isMachine?: boolean },
  candidates: T[],
  describe: (c: T) => { name: string; muscles?: MuscleTag[]; groupName?: string; isMachine?: boolean },
  minScore = 40,
): SimilarCandidate<T>[] {
  const t = { muscles: inferMuscles(target), equipment: inferEquipment(target) };
  return candidates
    .map((item) => {
      const d = describe(item);
      return {
        item,
        score: similarity(t, { muscles: inferMuscles(d), equipment: inferEquipment(d) }),
      };
    })
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
