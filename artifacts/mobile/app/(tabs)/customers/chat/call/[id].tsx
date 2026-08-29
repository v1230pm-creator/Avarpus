/**
 * Call screen route: app/(tabs)/customers/chat/call/[id]
 *
 * Route params:
 *   id    – LiveKit room ID
 *   mode  – "audio" | "video"  (default: "audio")
 *   name  – display name of the remote party (default: "Call")
 *
 * Flow:
 * 1. On mount, request a server-issued LiveKit token via useChatCallToken.
 * 2. On 503 or missing config show a fail-closed retry / back UI.
 * 3. On success, render the platform-split LiveKitCall component.
 * 4. Web renders an explanatory fallback (calls need the installed app).
 *
 * Authorization is handled by the parent _layout.tsx (chat layout).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatCallToken } from '@workspace/api-client-react';
import { useColors } from '@/hooks/useColors';
import type { CallMode, LiveKitCallProps } from '@/components/chat/LiveKitCallTypes';

function supportsLiveKitNative(): boolean {
  return (
    Platform.OS !== 'web' &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

type TokenState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; serverUrl: string; token: string }
  | { status: 'error'; message: string; is503: boolean };

export default function CallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();
  const liveKitNativeSupported = supportsLiveKitNative();

  // Do not evaluate @livekit/react-native inside Expo Go: its WebRTC native
  // module only exists in the custom Avarpus build. Conditional require keeps
  // the route itself loadable so ordinary Matrix messaging still works.
  const LiveKitCall: React.ComponentType<LiveKitCallProps> = liveKitNativeSupported
    ? require('@/components/chat/LiveKitCall').LiveKitCall
    : require('@/components/chat/LiveKitCall.web').LiveKitCall;

  const params = useLocalSearchParams<{
    id: string;
    mode?: string;
    name?: string;
  }>();

  const roomId = params.id ?? '';
  const mode: CallMode = params.mode === 'video' ? 'video' : 'audio';
  const remoteName = params.name ?? 'Call';

  const callTokenMutation = useChatCallToken();
  const [tokenState, setTokenState] = useState<TokenState>({ status: 'idle' });
  // Retry counter – incrementing this triggers a re-request
  const [retryCount, setRetryCount] = useState(0);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!liveKitNativeSupported) return;
    if (!roomId) {
      setTokenState({ status: 'error', message: 'Invalid room ID.', is503: false });
      return;
    }

    setTokenState({ status: 'loading' });

    callTokenMutation.mutate(
      { roomId },
      {
        onSuccess: (data) => {
          if (!isMounted.current) return;
          if (!data?.url || !data?.token) {
            setTokenState({
              status: 'error',
              message: 'Call service is not configured. Please contact support.',
              is503: false,
            });
            return;
          }
          setTokenState({ status: 'ready', serverUrl: data.url, token: data.token });
        },
        onError: (err: any) => {
          if (!isMounted.current) return;
          const status = err?.status ?? err?.response?.status;
          const is503 = status === 503;
          const message = is503
            ? 'Call service is currently unavailable. Please try again.'
            : err?.data?.message ?? err?.message ?? 'Could not start the call.';
          setTokenState({ status: 'error', message, is503 });
        },
      },
    );
    // We intentionally exclude callTokenMutation from deps to avoid re-runs
    // on unrelated renders; retryCount drives explicit retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, retryCount]);

  const handleHangup = useCallback(() => {
    router.back();
  }, [router]);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  // ── Unsupported-runtime fallback ───────────────────────────────────────
  // Web and Expo Go skip the token request and native LiveKit import.
  if (!liveKitNativeSupported) {
    return <LiveKitCall serverUrl="" token="" mode={mode} remoteName={remoteName} onHangup={handleHangup} />;
  }

  // ── Loading state ──────────────────────────────────────────────────────
  if (tokenState.status === 'idle' || tokenState.status === 'loading') {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top + 16 },
        ]}
        testID="call-loading-screen"
      >
        <ActivityIndicator color={colors.primary} size="large" />
        <Text
          style={[
            styles.loadingText,
            { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' },
          ]}
        >
          Preparing call…
        </Text>
      </View>
    );
  }

  // ── Error / unavailable state ──────────────────────────────────────────
  if (tokenState.status === 'error') {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top + 16 },
        ]}
        testID="call-error-screen"
      >
        <View
          style={[
            styles.errorCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather
            name={tokenState.is503 ? 'alert-triangle' : 'x-circle'}
            size={40}
            color={colors.destructive}
          />
          <Text
            style={[
              styles.errorTitle,
              { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
            ]}
            testID="call-error-title"
          >
            {tokenState.is503 ? 'Service unavailable' : 'Call failed'}
          </Text>
          <Text
            style={[
              styles.errorBody,
              { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' },
            ]}
            testID="call-error-body"
          >
            {tokenState.message}
          </Text>

          {/* E2EE note even on error screens */}
          <View style={[styles.e2eeRow, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}>
            <Feather name="shield" size={13} color={colors.mutedForeground} />
            <Text
              style={[styles.e2eeNote, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}
              testID="e2ee-disabled-note"
            >
              End-to-end encryption is not enabled
            </Text>
          </View>

          <View style={styles.errorActions}>
            {tokenState.is503 && (
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.primary }]}
                onPress={handleRetry}
                accessibilityLabel="Retry call"
                testID="retry-button"
              >
                <Feather name="refresh-cw" size={16} color="#fff" />
                <Text style={[styles.buttonText, { fontFamily: 'Inter_600SemiBold' }]}>
                  Retry
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.backButton, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleHangup}
              accessibilityLabel="Go back"
              testID="back-button"
            >
              <Text
                style={[
                  styles.backButtonText,
                  { color: colors.foreground, fontFamily: 'Inter_600SemiBold' },
                ]}
              >
                Go back
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Call ready — render native LiveKit UI ──────────────────────────────
  return (
    <LiveKitCall
      serverUrl={tokenState.serverUrl}
      token={tokenState.token}
      mode={mode}
      remoteName={remoteName}
      onHangup={handleHangup}
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
  },
  errorCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 14,
  },
  errorTitle: {
    fontSize: 20,
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  e2eeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    width: '100%',
  },
  e2eeNote: {
    fontSize: 12,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
  },
  backButton: {
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
  },
  backButtonText: {
    fontSize: 15,
  },
});
