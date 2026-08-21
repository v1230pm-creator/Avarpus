import React from 'react';
import { StyleSheet, View, ViewProps, Platform } from 'react-native';

export function FlatCard({ style, children, ...props }: ViewProps) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: '#FFFFFF',
          borderColor: '#E2E8F0',
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: {
        elevation: 2,
      },
      web: {
        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.05)',
      },
    }),
  },
});
