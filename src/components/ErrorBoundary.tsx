import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Without this, any render-time throw unmounts the whole app to a blank white
 * screen mid-workout — which is both alarming and indistinguishable from data
 * loss. A logged set is already in Dexie by the time it renders, so the honest
 * message is "your workout is saved, reload".
 *
 * ponytail: no error reporting service, no retry-without-reload. Single user,
 * one device; the reload button is the whole recovery story.
 */
interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { message } = this.state;
    if (message === null) return this.props.children;
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="card p-4 max-w-sm w-full text-center space-y-3">
          <p className="text-sm font-semibold">משהו נשבר במסך הזה</p>
          <p className="text-xs text-fg-muted">
            הסטים שסימנת נשמרו — הם לא הלכו לאיבוד. רענן כדי להמשיך.
          </p>
          <p className="text-2xs text-fg-ghost break-words">{message}</p>
          <button className="btn-primary w-full" onClick={() => location.reload()}>
            רענן
          </button>
        </div>
      </div>
    );
  }
}
