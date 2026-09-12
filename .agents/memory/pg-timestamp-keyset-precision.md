---
name: Keyset windows around a stored row
description: Why a (timestamp, id) window built from a JavaScript Date puts the anchor row on both sides of itself.
---

When paging or windowing around a specific row with a `(created_at, id)` keyset
comparison, compare against the stored row in SQL, not against a value read into
JavaScript first:

```
(created_at, id) < (select created_at, id from t where id = $anchor::uuid)
```

**Why:** Postgres `timestamptz` keeps microseconds; a JavaScript `Date` keeps
milliseconds. A row fetched into Node and sent back as a parameter is therefore
slightly *earlier* than the row it came from, so a strict `>` comparison matches
the anchor itself. The symptom is a window that contains the anchor twice — once
because it was appended deliberately, once because it leaked into the "after"
side — and a total that is one longer than the requested limit.

**How to apply:** any "N before and N after this row" query. Cursors that are
already serialized as ISO strings have the same truncation, which is tolerable
for forward paging but not for a window that must exclude its own centre.
