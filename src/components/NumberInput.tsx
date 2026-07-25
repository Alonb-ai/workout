import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

interface NumberInputProps {
  value: number | '';
  onChange: (v: number | '') => void;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  /** Ghost (dimmed) preview value to show when input is empty. */
  ghost?: number | string;
  /** Suffix label inside input (e.g., 'kg'). */
  suffix?: string;
  /** Use larger touch buttons on each side. */
  withSteppers?: boolean;
  ariaLabel?: string;
  /** Lets a sibling `<label htmlFor>` point at the real input. */
  id?: string;
  className?: string;
  decimals?: number;
  inputClassName?: string;
}

/**
 * NumberInput — mobile-first numeric editor.
 * - `inputmode="decimal"` for proper numeric keyboard on iOS/Android.
 * - "ghost" pre-fills last-session value visually until user types.
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  placeholder,
  ghost,
  suffix,
  withSteppers = false,
  ariaLabel,
  id,
  className,
  decimals = 2,
  inputClassName,
}: NumberInputProps) {
  const [text, setText] = useState<string>(value === '' ? '' : String(value));
  const [clamped, setClamped] = useState(false);
  const lastValue = useRef(value);
  const clampTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (lastValue.current !== value) {
      setText(value === '' ? '' : String(value));
      lastValue.current = value;
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (clampTimerRef.current !== null) window.clearTimeout(clampTimerRef.current);
    };
  }, []);

  const flashClamp = () => {
    setClamped(true);
    if (clampTimerRef.current !== null) window.clearTimeout(clampTimerRef.current);
    clampTimerRef.current = window.setTimeout(() => {
      setClamped(false);
      clampTimerRef.current = null;
    }, 700);
  };

  const push = (v: number | '') => {
    onChange(v);
    lastValue.current = v;
  };

  const clampRound = (n: number): { v: number; didClamp: boolean } => {
    let v = n;
    let didClamp = false;
    if (min !== undefined && v < min) {
      v = min;
      didClamp = true;
    }
    if (max !== undefined && v > max) {
      v = max;
      didClamp = true;
    }
    const factor = Math.pow(10, decimals);
    return { v: Math.round(v * factor) / factor, didClamp };
  };

  /**
   * Commit on every keystroke, not on blur. A weight typed but not blurred used
   * to exist only inside this component's local state, so the autosave — and
   * the flush that runs when the app is backgrounded — wrote a draft that was
   * missing the number the user had just entered. Clamping and rounding still
   * wait for blur, so intermediate text like "1." or "62." stays editable.
   */
  const handleInput = (s: string) => {
    setText(s);
    const cleaned = s.replace(',', '.').trim();
    if (cleaned === '' || cleaned === '-') {
      push('');
      return;
    }
    const n = Number(cleaned);
    if (Number.isFinite(n)) push(n);
  };

  /** Normalise on blur/Enter: clamp, round, and show exactly what was stored. */
  const commit = (s: string) => {
    const cleaned = s.replace(',', '.').trim();
    const n = Number(cleaned);
    if (cleaned === '' || cleaned === '-' || !Number.isFinite(n)) {
      setText('');
      push('');
      return;
    }
    const { v, didClamp } = clampRound(n);
    setText(String(v));
    push(v);
    if (didClamp) flashClamp();
  };

  const step$ = (delta: number) => {
    const current = value === '' ? 0 : Number(value);
    // Clamp rather than bail — bailing left the +/− buttons permanently dead
    // once the value sat on a boundary.
    const { v, didClamp } = clampRound(current + delta);
    push(v);
    setText(String(v));
    if (didClamp) flashClamp();
  };

  return (
    <div className={cn('flex items-center', className)}>
      {withSteppers && (
        <button
          type="button"
          className="btn-icon !min-w-10 !min-h-10 shrink-0"
          aria-label="פחות"
          onClick={() => step$(-step)}
        >
          −
        </button>
      )}
      <div className="relative flex-1">
        <input
          {...(id ? { id } : {})}
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          autoComplete="off"
          className={cn(
            'input num text-center w-full transition-shadow',
            // A ghost is the app's PRESCRIPTION, not an empty-field hint, so it
            // gets a dimmed accent instead of placeholder grey — the same colour
            // family as the prescription strip it came from. A real placeholder
            // ("—") stays grey.
            ghost !== undefined && text === '' && 'placeholder:text-accent-text/50',
            clamped && 'ring-2 ring-warn/70',
            inputClassName,
          )}
          value={text}
          placeholder={
            text === '' && ghost !== undefined ? String(ghost) : (placeholder ?? '')
          }
          aria-label={ariaLabel}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix && (
          <span className="absolute inset-y-0 left-3 flex items-center text-fg-muted text-xs pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {withSteppers && (
        <button
          type="button"
          className="btn-icon !min-w-10 !min-h-10 shrink-0"
          aria-label="עוד"
          onClick={() => step$(step)}
        >
          +
        </button>
      )}
    </div>
  );
}
