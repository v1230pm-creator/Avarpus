# Avarpus Android device key

This local Expo module provides the native half of Avarpus device-bound
sign-in. It is Android-only and is intentionally unavailable in Expo Go, web,
and iOS builds.

- `getOrCreateKeyPair(deviceId)` creates an RSA-2048 signing key in
  `AndroidKeyStore` and returns only its PEM public key.
- `signChallenge(challenge, deviceId)` signs the server's short-lived
  `AVP-...` challenge inside Android Keystore and returns a Base64 signature.
- The private key is never returned to JavaScript, AsyncStorage, SecureStore,
  or the API.

## Custom Android build verification

After building the app as a custom Android APK, use a real registered account:

1. Complete the SIM verification flow on the Android device.
2. Confirm **Sign in with device key** appears under the existing sign-in
   method after reopening the app.
3. Enter the registered mobile number and use that action.
4. Confirm the app reaches the tabs without entering an OTP and Settings →
   Login history labels the event **Device key**.

Expo Go must not show the device-key option. That absence confirms the app did
not substitute a JavaScript-managed private key.