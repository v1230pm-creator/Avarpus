/**
 * Decisions behind the one-hand reach gesture (see components/ui/ReachDown.tsx).
 *
 * Pure so the rules can be unit-tested; marked as worklets so the gesture can
 * call them on the UI thread while the finger is still down.
 */

/** Whether a finger meant to be resting has moved far enough to be a scroll or a swipe instead. */
export function strayed(dx: number, dy: number, slop: number): boolean {
  'worklet';
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

/**
 * How far down the page may go: everything but the top strip that must stay
 * on screen. A root that has not been measured yet (or is shorter than that
 * strip) cannot move at all.
 */
export function reachLimit(height: number, keep: number): number {
  'worklet';
  return Math.max(0, height - keep);
}

/**
 * Page offset while the finger drags: where the page was when it was taken
 * hold of, plus the finger's travel since, kept between its own top and the
 * limit. Nothing pulls the page anywhere on its own; it rests where it is left.
 */
export function heldShift(base: number, delta: number, limit: number): number {
  'worklet';
  const raw = base + delta;
  if (raw <= 0) return 0;
  if (raw >= limit) return limit;
  return raw;
}

/**
 * Whether a touch landed on a text field, whose own hold places the caret or
 * opens the paste menu. `target` is the touched host element: React Native's
 * DOM-like element on the phone (tag `RN:TextInput` on Android and iOS alike),
 * the browser's element on the web.
 */
export function isTextField(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const tag = (target as { tagName?: unknown }).tagName;
  return tag === 'RN:TextInput' || tag === 'INPUT' || tag === 'TEXTAREA';
}
