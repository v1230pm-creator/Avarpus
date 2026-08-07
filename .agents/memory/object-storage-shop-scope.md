---
name: Object storage shop scoping
description: How App Storage objects are isolated per shop and why attach/serve must validate the path prefix.
---

Upload URLs are issued under `/objects/uploads/<shopId>/<uuid>`; that prefix is the ownership proof.

**Why:** A review found cross-shop disclosure: any authed user could serve any private object, and arbitrary `/objects/...` paths could be attached to repairs/signatures. Prefix-scoping fixed both without an upload-grants table.

**How to apply:** Any new endpoint that attaches or serves an object path must check `path.startsWith('/objects/uploads/<callerShopId>/')` (serve route returns 404, attach routes 400). Signature/photo attach and the storage GET already do this — copy that pattern. Mobile must use the objectPath returned by requestUploadUrl verbatim.
