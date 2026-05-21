import type { Session } from '@/types';
import { parseISO, differenceInCalendarDays } from 'date-fns';

export function computeWeeklyVolume(sessions: Session[], today: string): number {
  const todayD = parseISO(today);
  return sessions.reduce((sum, s) => {
    const days = differenceInCalendarDays(todayD, parseISO(s.date));
    if (days < 0 || days >= 7) return sum;
    return sum + (s.totalVolume ?? 0);
  }, 0);
}
