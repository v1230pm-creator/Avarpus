---
name: Orval nullable object schemas
description: How to declare a nullable object field in openapi.yaml so both generated clients (api-client-react and api-zod) compile.
---

**Rule:** declare a nullable object field inline on the property (`type: object`, `nullable: true`, `properties`, `required`) — never as a named component with `nullable: true` that the property `$ref`s.

**Why:** Orval (v8.23) emits the api-zod types for a named nullable object component as `export interface X { … } | null`, which is a TS syntax error and fails `pnpm --filter @workspace/api-spec run codegen` at the `typecheck:libs` step. Inline, it emits `export type X = { … } | null` for both clients, and the property is typed `field?: X`.

**How to apply:** any new `… | null` object on a response schema (list projections such as a repair's cover photo). Nullable scalars/`additionalProperties` objects (`{ type: object, nullable: true, additionalProperties: true }`) are fine inline too. Remove a stray generated file under `lib/api-zod/src/generated/types/` before re-running codegen if a broken attempt left one behind.
