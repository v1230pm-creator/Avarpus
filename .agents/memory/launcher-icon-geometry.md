---
name: Launcher icon geometry
description: Why Avarpus icon artwork is sized by its enclosing circle and why the adaptive foreground must never contain a background disc.
---

Two rules govern every regenerated Avarpus icon/logo asset.

**1. Centre on the bubble ring; size by the farthest pixel from that centre.**
The mark is a ring with a speech-bubble tail sticking out diagonally. Centring
on the whole silhouette (bounding box or minimum enclosing circle) drags the
ring off-centre, which the owner rejects on sight. Centring on the ring alone
and ignoring the tail gets the tail clipped by a circular mask.

Both constraints hold at once: put the RING centre at the canvas centre, then
scale so the farthest opaque pixel — the tail tip — just touches the safe
radius. The tail may touch that edge; it must never cross it.

**Why:** two rounds of rejected icons, first for a cut tail, then for an
off-centre logo.

**How to apply:** fit a circle to the outline with iterative outlier rejection
(the rejected points are the tail) for the centre, then measure the maximum
radius from that centre. Safe radius is 66/108 of the canvas diameter for an
Android adaptive foreground, just under half the canvas for a full-bleed icon a
launcher may circle-mask.

**2. The adaptive foreground carries the mark only — no coloured disc.**
A blue disc baked into the foreground sits on top of `adaptiveIcon.backgroundColor`
and reads as a faded ring whenever the two shades differ. The background colour
in app.json must equal the one flat brand blue used in the artwork.

**Also:** when compositing, resample the alpha channel alone and rebuild the
white artwork from it. Resizing RGBA together drags colour across the edge and
leaves stray off-brand pixels in what must be a two-colour image.

A validation step re-derives all of this from the pixels, so run it after any
icon edit rather than eyeballing the PNGs.
