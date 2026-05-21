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
  className,
  decimals = 2,
  inputClassName,
}: NumberInputProps) {
  const [text, setText] = useState<string>(value === '' ? '' : String(value));
  const lastValue = useRef(value);

  useEffect(() => {
    if (lastValue.current !== value) {
      setText(value === '' ? '' : String(value));
      lastValue.current = value;
    }
  }, [value]);

  const commit = (s: string) => {
    const cleaned = s.replace(',', '.').trim();
    if (cleaned === '' || cleaned === '-') {
      onChange('');
      lastValue.current = '';
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    // Round to decimals
    const factor = Math.pow(10, decimals);
    v = Math.round(v * factor) / factor;
    onChange(v);
    lastValue.current = v;
  };

  const step$ = (delta: number) => {
    const current = value === '' ? 0 : Number(value);
    const next = current + delta;
    const factor = Math.pow(10, decimals);
    const v = Math.round(next * factor) / factor;
    if (min !== undefined && v < min) return;
    if (max !== undefined && v > max) return;
    onChange(v);
    setText(String(v));
    lastValue.current = v;
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
          type="text"
          inputMode="decimal"
          pattern="[0-9]*[.,]?[0-9]*"
          autoComplete="off"
          className={cn(
            'input num text-center w-full',
            ghost !== undefined && text === '' && 'placeholder:text-fg-ghost',
            inputClassName,
          )}
          value={text}
          placeholder={
            text === '' && ghost !== undefined ? String(ghost) : (placeholder ?? '')
          }
          aria-label={ariaLabel}
          onChange={(e) => setText(e.target.value)}
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
