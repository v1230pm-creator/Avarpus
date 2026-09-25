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
import { font, fontFamily } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
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
          style={[styles.title, { color: colors.foreground, fontFamily: fontFamily.bold }]}
          accessibilityRole="header"
        >
          Calls require the installed app
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}>
          Voice and video calls are available in the Avarpus Android or iOS app.
          They are not supported in the browser or Expo Go.
        </Text>
        <View style={[styles.e2eeRow, { backgroundColor: colors.backgroundSecondary }]}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text
            style={[styles.e2eeText, { color: colors.mutedForeground, fontFamily: fontFamily.regular }]}
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
          <Text style={[styles.backButtonText, { fontFamily: fontFamily.semibold }]}>Go back</Text>
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
    padding: layout.screenPadding,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 16,
    borderWidth: 1,
    padding: space.lg,
    alignItems: 'center',
    gap: 16,
  },
  title: {
    ...font.itemTitle,
    textAlign: 'center',
    marginTop: 8,
  },
  body: {
    ...font.small,
    textAlign: 'center',
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
    ...font.small,
  },
  backButton: {
    minHeight: size.button,
    paddingHorizontal: space.xxl,
    borderRadius: radius.sm,
    marginTop: 4,
  },
  backButtonText: {
    color: '#FFFFFF',
    ...font.button,
  },
});
