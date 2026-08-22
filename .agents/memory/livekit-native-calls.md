---
name: LiveKit native calls
description: Native runtime and acceptance-test boundary for VMC audio/video calls.
---

LiveKit React Native calls are native-only in this Expo app. Expo Go and the web preview can show fallbacks but cannot load or validate the WebRTC media path.

**Why:** The LiveKit React Native SDK depends on native WebRTC modules. Mocked JavaScript tests can verify token handling and lifecycle guards, but they cannot prove microphone, camera, speaker routing, or remote media behavior.

**How to apply:** After any call change, create a fresh custom APK/development build and test with real LiveKit credentials on two physical devices. Verify connect/error, mute, camera, speaker, remote disconnect, and hang-up. Treat incoming-call ringing/background push and E2EE as separate work until explicitly implemented.