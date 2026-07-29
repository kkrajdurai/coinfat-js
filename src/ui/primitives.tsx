/**
 * Shared UI primitives. Icons are inline SVG rather than a library: every dependency
 * is bytes on someone else's checkout page.
 */

import type {ComponentChildren} from "preact";
import {useEffect, useRef, useState} from "preact/hooks";
import {formatDuration, remainingUntil} from "./payment.js";
import {useStrings} from "./strings/context.js";

const ICON = "size-4 shrink-0";

/** The stroke attributes every icon path shares, in three combinations. */
const STROKE = {stroke: "currentColor", "stroke-width": "2"} as const;
const CAPPED = {...STROKE, "stroke-linecap": "round"} as const;
const ROUNDED = {...CAPPED, "stroke-linejoin": "round"} as const;

function Icon({
  class: className = ICON,
  children
}: {
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <svg class={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

export function CopyIcon() {
  return (
    <Icon>
      <rect x="9" y="9" width="11" height="11" rx="2" {...STROKE} />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" {...CAPPED} />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon>
      <path d="m5 13 4 4L19 7" {...ROUNDED} />
    </Icon>
  );
}

export function LockIcon() {
  return (
    <Icon class="size-3 shrink-0">
      <rect x="4" y="10" width="16" height="11" rx="2" {...STROKE} />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" {...CAPPED} />
    </Icon>
  );
}

export function ArrowLeftIcon() {
  return (
    <Icon class="size-3.5 shrink-0">
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" {...ROUNDED} />
    </Icon>
  );
}

export function SwapIcon() {
  return (
    <Icon class="size-3.5 shrink-0">
      <path d="M7 7h13m0 0-4-4m4 4-4 4" {...ROUNDED} />
      <path d="M17 17H4m0 0 4-4m-4 4 4 4" {...ROUNDED} />
    </Icon>
  );
}

export function RefreshIcon() {
  return (
    <Icon>
      <path d="M20 11a8 8 0 1 0-.6 4" {...CAPPED} />
      <path d="M20 4v7h-7" {...ROUNDED} />
    </Icon>
  );
}

export function Spinner() {
  return (
    <Icon class={`${ICON} animate-spin`}>
      <circle cx="12" cy="12" r="9" class="opacity-25" {...STROKE} />
      <path d="M21 12a9 9 0 0 0-9-9" {...CAPPED} />
    </Icon>
  );
}

export function ClockIcon() {
  return (
    <Icon class="size-7">
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M12 7v5l3 2" {...ROUNDED} />
    </Icon>
  );
}

export function CircleXIcon() {
  return (
    <Icon class="size-7">
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="m15 9-6 6m0-6 6 6" {...ROUNDED} />
    </Icon>
  );
}

/**
 * The brand mark, ported from the frontend's `CoinfatIcon`. Painted in `currentColor`
 * rather than that one's brand-orange gradient, so the attribution badge can tone it
 * down instead of competing with the merchant's `--cf-primary`.
 */
export function BrandMarkIcon({class: className = ICON}: {class?: string}) {
  return (
    <svg
      class={className}
      viewBox="0 0 144.41 149.58"
      fill="currentColor"
      aria-hidden="true">
      <path d="m144.39,19.54c.91,4.54-29.89,14.55-68.8,22.36C36.68,49.7,4.4,52.35,3.49,47.8L.02,30.49c-.91-4.54,29.89-14.55,68.8-22.36C107.73.33,140.01-2.32,140.92,2.22l3.47,17.31Zm-73.25,46.79C31.85,66.32,0,70.08,0,74.71v17.66C0,97,31.85,100.75,71.14,100.75s71.14-3.75,71.14-8.39v-17.66c0-4.63-31.85-8.39-71.14-8.39ZM1.88,117.25c-2.5,9.92-2.5,20.3,0,30.21,10.97,2.81,20.32,2.81,31.29,0,2.5-9.92,2.5-20.3,0-30.21-10.97-2.81-20.32-2.81-31.29,0Z" />
    </svg>
  );
}

const BUTTON_BASE =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60";

const BUTTON_VARIANT = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-transparent hover:bg-muted/50"
} as const;

export interface ButtonProps {
  children: ComponentChildren;
  onClick: () => void;
  variant?: keyof typeof BUTTON_VARIANT;
  disabled?: boolean;
  busy?: boolean;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  busy
}: ButtonProps) {
  return (
    <button
      type="button"
      class={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`}
      disabled={disabled || busy}
      aria-busy={busy ? "true" : undefined}
      onClick={onClick}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** A link styled as a button — for terminal-state actions that navigate to a URL. */
export function LinkButton({
  href,
  variant = "primary",
  children
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANT;
  children: ComponentChildren;
}) {
  return (
    <a href={href} class={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`}>
      {children}
    </a>
  );
}

export interface CopyFieldProps {
  /** What lands on the clipboard — often not what is rendered. */
  text: string;
  label: string;
  children: ComponentChildren;
  class?: string;
}

/**
 * Copy-to-clipboard around arbitrary content. The whole thing is the button, since
 * a payer's instinct is to tap the address itself.
 */
export function CopyField({
  text,
  label,
  children,
  class: className = ""
}: CopyFieldProps) {
  const strings = useStrings();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    // Absent over plain HTTP and in some webviews. Failing silently beats throwing
    // inside a merchant's page over a convenience affordance.
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        class={`group flex items-center gap-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
        onClick={copy}>
        {children}
        <span class={copied ? "text-success" : "text-muted-foreground"}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </span>
      </button>
      <span
        // Outside the button on purpose: its aria-label replaces the whole subtree
        // for name computation, so a status nested inside is never read. Mounted
        // always — see the live-region note in PayPanel.
        class="sr-only"
        role="status">
        {copied ? strings.copied : ""}
      </span>
    </>
  );
}

export interface CountdownProps {
  /** ISO timestamp to count down to. */
  target: string;
  onElapsed?: () => void;
}

/**
 * Ticking "m:ss" until `target`, firing `onElapsed` once when it passes. `onElapsed`
 * is held in a ref so an inline arrow does not restart the interval on every render:
 * the effect depends on `target` alone, which is also what re-arms it after a requote
 * moves the deadline.
 */
export function useCountdown({target, onElapsed}: CountdownProps): number {
  const elapsedRef = useRef(onElapsed);
  elapsedRef.current = onElapsed;

  const [remaining, setRemaining] = useState(() => remainingUntil(target));

  useEffect(() => {
    setRemaining(remainingUntil(target));
    let fired = false;

    const tick = setInterval(() => {
      const next = remainingUntil(target);
      setRemaining(next);

      if (next <= 0 && !fired) {
        fired = true;
        elapsedRef.current?.();
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [target]);

  return remaining;
}

/** The rate-lock bar: how long the quoted amount holds. */
export function RateLock({target, onElapsed}: CountdownProps) {
  const strings = useStrings();
  // Captured once as the progress-bar denominator: the component re-renders every
  // second, so this must NOT recompute from the shrinking `remainingUntil`. The call
  // site keys on `target`, so a new deadline remounts with a fresh total.
  const totalRef = useRef(Math.max(1, remainingUntil(target)));
  const remaining = useCountdown({target, onElapsed});

  const pct = Math.max(0, Math.min(100, (remaining / totalRef.current) * 100));
  const low = remaining < 60_000;

  return (
    <div class="space-y-1.5">
      <div class="flex items-center justify-between text-xs text-muted-foreground">
        <span class="flex items-center gap-1.5">
          <LockIcon />
          {strings.amountLocked}
        </span>
        <span class="font-medium tabular-nums">
          {formatDuration(remaining)}
        </span>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          style={{width: `${pct}%`}}
          class={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
            low ? "bg-warning" : "bg-accent-surface"
          }`}
        />
      </div>
    </div>
  );
}
