// Entry point that scripts/test-chat-relay-purge-e2e.mjs bundles (with the
// server's own esbuild options, see build.mjs) into its private run directory.
// It re-exports the production purge and the storage service so the check
// drives the exact code the API ships rather than a copy of it. It is not part
// of the server bundle and is not type-checked with src/ (its imports are, and
// esbuild fails the build if any name here stops existing).
export {
  readChatRelayPolicy,
  readMinimumSupportedAppBuild,
  runChatRelayCleanup,
} from "../../src/lib/chatRelayCleanup";
export { CHAT_RELAY_MIN_APP_BUILD } from "../../src/lib/chatRelayPolicy";
export { ObjectNotFoundError, ObjectStorageService } from "../../src/lib/objectStorage";
