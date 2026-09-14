import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkWindowLimit } from "./rateLimit";

const WINDOW_MS = 15 * 60 * 1000;
let keySeq = 0;
const freshKey = () => `window-test:${Date.now()}:${keySeq++}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkWindowLimit reservations", () => {
  it("release() hands a slot back exactly once", () => {
    const key = freshKey();
    const first = checkWindowLimit(key, 2, WINDOW_MS);
    const second = checkWindowLimit(key, 2, WINDOW_MS);
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(true);

    second.release();
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(false);
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(true);

    // A second release of the same reservation must not free another slot.
    second.release();
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(true);
    first.release();
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(false);
  });

  it("a limited reservation has nothing to release", () => {
    const key = freshKey();
    checkWindowLimit(key, 1, WINDOW_MS);
    const denied = checkWindowLimit(key, 1, WINDOW_MS);
    expect(denied.limited).toBe(true);
    denied.release();
    expect(checkWindowLimit(key, 1, WINDOW_MS).limited).toBe(true);
  });

  it("releasing a slot from an expired window never debits the new window", () => {
    const key = freshKey();
    const stale = checkWindowLimit(key, 2, WINDOW_MS);
    // A slow in-flight send outlives the window; a newer caller rolls it over.
    vi.advanceTimersByTime(WINDOW_MS + 1);
    const fresh = checkWindowLimit(key, 2, WINDOW_MS);
    expect(fresh.limited).toBe(false);

    stale.release();
    // The new window still holds one delivered send, so exactly one more fits.
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(false);
    expect(checkWindowLimit(key, 2, WINDOW_MS).limited).toBe(true);
  });

  it("releasing the last slot clears the entry so the window restarts cleanly", () => {
    const key = freshKey();
    const only = checkWindowLimit(key, 1, WINDOW_MS);
    only.release();
    expect(checkWindowLimit(key, 1, WINDOW_MS).limited).toBe(false);
    expect(checkWindowLimit(key, 1, WINDOW_MS).limited).toBe(true);
  });
});
