/**
 * Platform-split LiveKit call component.
 *
 * Metro/Expo will automatically resolve:
 *   - LiveKitCall.native.tsx  on iOS/Android
 *   - LiveKitCall.web.tsx     on web
 *
 * This file provides TypeScript type declarations so the unqualified import
 * `@/components/chat/LiveKitCall` resolves during type-checking.
 *
 * At runtime this file is NOT used — Metro selects the platform variant.
 */
export { LiveKitCall } from './LiveKitCall.web';
