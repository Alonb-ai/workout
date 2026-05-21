import { useEffect, useState } from 'react';

/**
 * Re-renders on a 1Hz tick. Use sparingly — for timers and time-of-day badges.
 */
export function useTick(intervalMs = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return t;
}
