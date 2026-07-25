import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  IconHome,
  IconBarbell,
  IconList,
  IconPill,
  IconChart,
} from './Icon';
import { GlobalRestTimerBar } from '@/features/workout/RestTimerBar';
import { useTimerStore } from '@/store/timer';
import { cn } from '@/utils/cn';

const TABS = [
  { to: '/', label: 'בית', icon: IconHome, end: true },
  { to: '/workout', label: 'אימון', icon: IconBarbell },
  { to: '/plan', label: 'תכנית', icon: IconList },
  { to: '/supplements', label: 'תוספים', icon: IconPill },
  { to: '/progress', label: 'התקדמות', icon: IconChart },
];

/** Content height of the bar, without the safe-area inset below it. */
const BAR_H = 60;

export function AppShell() {
  const { pathname } = useLocation();
  // HashRouter pushState doesn't reset scroll — new tabs would open mid-page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  // The rest timer bar floats above the tab bar; reserve its height too.
  const timerUp = useTimerStore((s) => s.endsAt !== null);
  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-full flex flex-col">
      <main
        className={`flex-1 ${timerUp ? 'pb-tabbar-timer' : 'pb-tabbar'} safe-top px-4 max-w-2xl w-full mx-auto`}
      >
        <Outlet />
      </main>

      {/* The bar is glass, so content stays visible through it. This scrim gives
          that content somewhere to dissolve into instead of being sliced off by
          a hard edge. Sits below the rest timer bar (z-30) on purpose. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 z-20 h-8 bg-gradient-to-t from-ink-950 to-transparent"
        style={{ bottom: `calc(${BAR_H}px + var(--safe-bottom))` }}
      />

      <GlobalRestTimerBar />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-ink-900/70 backdrop-blur-xl backdrop-saturate-150"
        style={{
          paddingBottom: 'var(--safe-bottom)',
          paddingInlineStart: 'var(--safe-left)',
          paddingInlineEnd: 'var(--safe-right)',
        }}
        aria-label="ניווט ראשי"
      >
        {/* Hairline highlight: the bar is lit from above, like a card. */}
        <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/[0.06]" />

        <ul className="flex items-stretch max-w-2xl mx-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.to} className="flex-1">
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    cn(
                      'relative flex flex-col items-center justify-center gap-0.5 text-2xs transition-colors duration-150',
                      isActive
                        ? 'text-accent-text font-semibold'
                        : 'text-fg-dim font-medium hover:text-fg',
                    )
                  }
                  style={{ height: BAR_H }}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="tab-indicator"
                          aria-hidden
                          className="absolute inset-x-4 top-0 h-[2px] rounded-full bg-accent shadow-accent-lift"
                          transition={
                            reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }
                          }
                        />
                      )}
                      <span
                        className={cn(
                          'flex h-8 w-12 items-center justify-center rounded-xl transition-colors duration-150',
                          isActive && 'bg-accent-soft',
                        )}
                      >
                        <Icon size={21} />
                      </span>
                      <span>{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
