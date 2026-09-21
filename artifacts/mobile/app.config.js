// Dynamic layer over app.json. Everything static stays in app.json (brand and
// release tooling read it directly); this file only wires in the Firebase
// client config that Android push delivery needs and that must not be
// committed to the repository.
//
// Android push goes: server → Expo Push Service → FCM → device. FCM only
// accepts a device registration when the APK was built with the Firebase
// client config (google-services.json) for package com.avarpus.app.
// Without it the app cannot obtain a push token at all, and every
// registration fails silently — which is exactly how push stayed dead in the
// released builds. So a release build refuses to proceed without the file.
//
// Provide it either as a file next to this config (ignored by git) or as an
// EAS file environment variable named GOOGLE_SERVICES_JSON, which EAS
// materialises to a path at build time.
const fs = require('fs');
const path = require('path');

const LOCAL_GOOGLE_SERVICES = path.join(__dirname, 'google-services.json');

function resolveGoogleServicesFile() {
  const fromEnv = process.env.GOOGLE_SERVICES_JSON;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (fs.existsSync(LOCAL_GOOGLE_SERVICES)) return './google-services.json';
  return null;
}

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile();
  const isReleaseBuild = process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD_PLATFORM === 'android';

  if (!googleServicesFile && isReleaseBuild) {
    throw new Error(
      'google-services.json is missing. Android push notifications cannot work without the ' +
        'Firebase client config for com.avarpus.app. Add the file to artifacts/mobile/ ' +
        'or set the EAS file environment variable GOOGLE_SERVICES_JSON, then rebuild.',
    );
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
    extra: {
      ...config.extra,
      // Lets the in-app diagnostics screen say whether this build was made
      // with Firebase configured, without shipping any credential.
      pushFirebaseConfigured: Boolean(googleServicesFile),
    },
  };
};
