import { afterEach, describe, expect, it, vi } from "vitest";
import { msg91VerifyOtp } from "./msg91";

const ORIGINAL_AUTH_KEY = process.env["MSG91_AUTH_KEY"];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (ORIGINAL_AUTH_KEY === undefined) {
    delete process.env["MSG91_AUTH_KEY"];
  } else {
    process.env["MSG91_AUTH_KEY"] = ORIGINAL_AUTH_KEY;
  }
});

describe("msg91VerifyOtp", () => {
  it("aborts a response whose JSON body stalls and returns the safe provider failure", async () => {
    vi.useFakeTimers();
    process.env["MSG91_AUTH_KEY"] = "test-auth-key";

    let signal!: AbortSignal;
    const stalledJson = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init!.signal as AbortSignal;
        return { ok: true, status: 200, json: stalledJson } as unknown as Response;
      }),
    );

    const verify = msg91VerifyOtp("9876543210", "123456");
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(verify).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^MSG91 verify failed:/),
    });
    expect(stalledJson).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(true);
  });
});