---
name: Multiline Input growth across platforms
description: Why the shared Input's multiline box must never receive rows/numberOfLines natively, how web auto-grow is done, and how compact toggle values avoid mid-word breaks.
---

**Rule:** an auto-growing multiline `Input` gets no `numberOfLines`/`rows` on Android or iOS; on web it gets `rows={1}` plus an effect that resets the `<textarea>` height to `auto` and then to `scrollHeight` on every value change. Cap growth with `maxHeight` in `style` (CSS still honours it on web).

**Why:** Android maps `numberOfLines`/`rows` to `TextView.setLines`, which *fixes* the height and stops the box from growing. React Native Web does the opposite: a `<textarea>` without `rows` defaults to two browser rows and never grows; its `scrollHeight` also never shrinks below the current height, so the height must be reset before re-measuring or deleted lines leave a tall box.

**How to apply:** keep this logic in `components/ui/Input.tsx`; callers just pass `multiline` (+ optional `maxHeight`). The Input's `style` prop is merged after the base styles (it used to replace them and silently dropped the Inter font), so callers no longer need `as any` overrides.

**Compact toggle values (three-up rows at 360dp):** `adjustsFontSizeToFit` with `numberOfLines={2}` does NOT shrink a single long word — Android breaks it mid-word ("Smartph/one") and calls that a fit. Allow 2 lines only for values containing a space; single words stay on 1 line so they shrink instead. `adjustsFontSizeToFit` is a no-op on the web preview, so web truncation of one long word is expected there.
