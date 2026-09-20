---
name: Chat attachments — any file type
description: Rules for chat attachments after opening them to every file type (photos, videos, docs, archives, APKs); server byte-sniffing, client queue authority, temp-file ownership.
---

# Chat attachments accept every file type

**Rule:** There is no attachment allow-list. Anything up to the size cap may be sent as
`kind: "file"`. Only the viewer-safe kinds (`image`, `video`, `audio`) are constrained,
and they are constrained by the *stored bytes*, not by the declared MIME.

**Why:** The user explicitly asked for JPG, video, .rar, .zip, .apk, "everything" to be
sendable. A MIME allow-list was the earlier design and it blocked archives/APKs. But the
declared content type on the stored object is whatever the client PUT, so an attacker could
label an executable `image/png` and have the recipient app hand it to an inline viewer.

**How to apply:**
- On attach, the server downloads the leading bytes of the stored object and classifies
  them (JPEG/PNG/GIF/BMP/WebP/HEIC/AVIF, PDF, MP3/AAC/FLAC/OGG/AMR/WAV/M4A, MKV/WebM/MP4/
  MOV/3GP/AVI). A declared image/video/audio/pdf whose bytes do not match is demoted to
  `application/octet-stream`. With `kind: image|video|audio` that becomes a 400
  `CHAT_MEDIA_KIND_MISMATCH`; with `kind: file` it is stored as an opaque document.
- The forward path is not re-sniffed: the source message was verified at attach time.
- `audio` kind is reserved for voice notes (needs `durationMs`); an MP3 chosen from the
  document picker is sent as `kind: file`. SVG is never an inline image (script risk).
- ADTS AAC: the layer bits are `00`, so only the 11-bit sync word can be checked; a
  13-bit check silently rejects every voice note.

# Client-side queue and temp files

- The outgoing attachment queue's **ref is the single authority**; every operation writes
  the ref first and mirrors into state for rendering. Never re-derive the ref from state
  during render — an in-flight render rolled back an imperative dequeue and re-sent the
  head item.
- Cache copies made from `content://` URIs are app-owned (`ownedTempFile`) and must be
  deleted on every exit: oversize/unreadable, partial batch failure, clear, unmount.
  Share-sheet downloads are deleted after `shareAsync`; the Android VIEW copy is kept
  under a deterministic name because the target app may still read the content URI.
- Sheet behaviour the user signed off on: tapping a recent item selects (single or
  multi), a Send control in the same sheet sends, and nothing reaches the recipient
  before Send. Gallery = photos + videos only; Document = all files.
- Batch sends stop at the first failure with the failed item at the head; Retry resumes
  there without re-uploading earlier items.
- Registered users' server profile photo wins over the device contact photo everywhere
  (contacts list, chat header, call screen via a `photo` route param).
