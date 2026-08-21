import React from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlatCard } from '@/components/ui/FlatCard';

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { type, name } = useLocalSearchParams<{
    id: string;
    type: 'customer' | 'dealer';
    name?: string;
  }>();
  const topPadding = Platform.OS === 'web' ? insets.top + 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconButton}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={22} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name || 'Chat'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {type === 'dealer' ? 'Dealer' : 'Customer'} · Service pending
          </Text>
        </View>
        <View style={styles.disabledHeaderAction} accessibilityLabel="Voice calls unavailable">
          <Feather name="phone" size={20} color="#94A3B8" />
        </View>
        <View style={styles.disabledHeaderAction} accessibilityLabel="Video calls unavailable">
          <Feather name="video" size={20} color="#94A3B8" />
        </View>
      </View>

      <View style={styles.chatArea}>
        <FlatCard style={styles.noticeCard}>
          <View style={styles.noticeIcon}>
            <Feather name="message-circle" size={24} color="#0B63F6" />
          </View>
          <Text style={styles.noticeTitle}>Chat setup pending</Text>
          <Text style={styles.noticeText}>
            Messaging, attachments, voice notes and calls will be available after the
            communication service is connected.
          </Text>
          <View style={styles.safetyNote}>
            <Feather name="shield" size={15} color="#64748B" />
            <Text style={styles.safetyText}>Nothing is sent or stored from this screen.</Text>
          </View>
        </FlatCard>
      </View>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.disabledAction} accessibilityLabel="Attachments unavailable">
          <Feather name="plus" size={20} color="#94A3B8" />
        </View>
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Messaging is not available yet"
            placeholderTextColor="#94A3B8"
            editable={false}
            pointerEvents="none"
          />
          <View style={styles.disabledAttachment}>
            <Feather name="paperclip" size={18} color="#94A3B8" />
          </View>
        </View>
        <View style={styles.disabledAction} accessibilityLabel="Voice notes unavailable">
          <Feather name="mic" size={20} color="#94A3B8" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitleContainer: { flex: 1, paddingHorizontal: 8 },
  headerTitle: {
    fontSize: 16,
    color: '#111827',
    fontFamily: 'Inter_700Bold',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  disabledHeaderAction: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.72,
  },
  chatArea: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noticeCard: {
    alignItems: 'center',
    padding: 24,
    maxWidth: 420,
    width: '100%',
  },
  noticeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  noticeTitle: {
    fontSize: 17,
    color: '#111827',
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
  },
  safetyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F3F7FF',
  },
  safetyText: {
    flexShrink: 1,
    fontSize: 11,
    color: '#64748B',
    fontFamily: 'Inter_500Medium',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  disabledAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.72,
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F7FF',
    borderRadius: 20,
    paddingLeft: 16,
    paddingRight: 8,
    height: 42,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  input: {
    flex: 1,
    fontSize: 13,
    color: '#94A3B8',
    fontFamily: 'Inter_400Regular',
  },
  disabledAttachment: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});