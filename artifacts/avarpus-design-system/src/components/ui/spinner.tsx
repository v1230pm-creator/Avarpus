import { cn } from '../../lib/utils';

/**
 * Avarpus loading mark.
 *
 * Twelve tapered blades on a circle; the brightest blade leads and the trail
 * fades behind it, so the ring reads as a clockwise sweep. This is the single
 * loading motion for the product — pages should not invent their own border
 * spinners.
 */

const BLADES = 12;
const KEYFRAMES_ID = 'avarpus-spinner-keyframes';

// Injected once per document so the component stays drop-in and does not
// depend on an app-specific stylesheet.
if (typeof document !== 'undefined' && !document.getElementById(KEYFRAMES_ID)) {
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `@keyframes avarpus-spinner-turn{to{transform:rotate(360deg)}}`;
  document.head.appendChild(style);
}

const blades = Array.from({ length: BLADES }, (_, index) => ({
  index,
  // Trail runs anti-clockwise from the leading blade, so the bright head
  // points the way the ring is turning.
  angle: -index * (360 / BLADES),
  opacity: Math.max(0.14, 1 - index * 0.08),
}));

export type SpinnerProps = {
  /** Outer diameter in pixels. */
  size?: number;
  className?: string;
  /** Screen-reader label; pass null inside already-labelled controls. */
  label?: string | null;
};

function Spinner({ size = 16, className, label = 'Loading' }: SpinnerProps) {
  const bladeWidth = Math.max(1.5, size * 0.11);
  const bladeHeight = Math.max(4, size * 0.28);
  const radius = size / 2 - bladeHeight / 2;

  return (
    <span
      role="status"
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      className={cn('inline-block shrink-0 text-primary', className)}
      style={{ width: size, height: size }}
    >
      <span
        className="relative block h-full w-full"
        style={{ animation: `avarpus-spinner-turn ${900}ms linear infinite` }}
      >
        {blades.map((blade) => (
          <span
            key={blade.index}
            className="absolute block bg-current"
            style={{
              left: (size - bladeWidth) / 2,
              top: (size - bladeHeight) / 2,
              width: bladeWidth,
              height: bladeHeight,
              borderRadius: bladeWidth / 2,
              opacity: blade.opacity,
              transform: `rotate(${blade.angle}deg) translateY(${-radius}px)`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * Full-page loading state for routes that have nothing else to show yet.
 */
function FullPageLoader({ message, className }: { message?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-screen w-full flex-col items-center justify-center gap-4 bg-background',
        className,
      )}
    >
      <Spinner size={44} />
      {!!message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

/**
 * Centered loading state that fills whatever region it is dropped into
 * (panels, tables, dialogs) instead of the whole viewport.
 */
function SectionLoader({ message, className }: { message?: string; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col items-center justify-center gap-3 py-12', className)}>
      <Spinner size={32} />
      {!!message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

export { Spinner, FullPageLoader, SectionLoader };
