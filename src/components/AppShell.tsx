import { NavLink, Outlet } from 'react-router-dom';
import {
  IconHome,
  IconBarbell,
  IconList,
  IconPill,
  IconChart,
} from './Icon';
import { GlobalRestTimerBar } from '@/features/workout/RestTimerBar';

const TABS = [
  { to: '/', label: 'בית', icon: IconHome, end: true },
  { to: '/workout', label: 'אימון', icon: IconBarbell },
  { to: '/plan', label: 'תכנית', icon: IconList },
  { to: '/supplements', label: 'תוספים', icon: IconPill },
  { to: '/progress', label: 'התקדמות', icon: IconChart },
];

export function AppShell() {
  return (
    <div className="min-h-full flex flex-col">
      <main className="flex-1 pb-tabbar safe-top px-4 max-w-2xl w-full mx-auto">
        <Outlet />
      </main>

      <GlobalRestTimerBar />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 bg-ink-900/95 backdrop-blur border-t border-line"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="ניווט ראשי"
      >
        <ul className="flex items-stretch max-w-2xl mx-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <li key={tab.to} className="flex-1">
                <NavLink
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `flex flex-col items-center justify-center gap-1 py-2 text-2xs font-medium transition-colors ${
                      isActive ? 'text-accent' : 'text-fg-muted hover:text-fg'
                    }`
                  }
                  style={{ minHeight: 60 }}
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`p-1.5 rounded-xl transition-colors ${
                          isActive ? 'bg-accent-soft' : ''
                        }`}
                      >
                        <Icon size={22} />
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
