/**
 * Web platform stub for LiveKit calls.
 *
 * Native LiveKit WebRTC is not supported in the Expo web/browser bundle.
 * Show an explanatory message directing the user to the installed app.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import type { LiveKitCallProps } from './LiveKitCallTypes';

export function LiveKitCall({ onHangup }: LiveKitCallProps) {
  const colors = useColors();

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      testID="livekit-web-fallback"
    >
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="smartphone" size={40} color={colors.primary} />
        <Text
          style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
          accessibilityRole="header"
        >
          Calls require the installed app
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Voice and video calls are available in the VMC Electronic BMS Android or iOS app.
          They are not supported in the browser or Expo Go.
        </Text>
        <View style={[styles.e2eeRow, { backgroundColor: colors.backgroundSecondary }]}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.e2eeText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}
            testID="e2ee-disabled-note"
          >
            End-to-end encryption is not enabled
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.backButton, { backgroundColor: colors.primary }]}
          onPress={onHangup}
          accessibilityLabel="Go back"
          testID="web-back-button"
        >
          <Text style={[styles.backButtonText, { fontFamily: 'Inter_600SemiBold' }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    fontSize: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  body: {
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
  e2eeText: {
    fontSize: 12,
  },
  backButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
});
