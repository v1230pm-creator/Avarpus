import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingCompat } from '@/components/KeyboardAvoidingCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Button } from '@/components/ui/Button';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  loading?: boolean;
  children: React.ReactNode;
}

/**
 * Slide-up modal used by the add/edit record forms. Keeps the form mounted
 * while submitting so entered values survive a failed save for retry.
 */
export function FormSheet({ visible, title, onClose, onSubmit, submitLabel = 'Save', loading = false, children }: FormSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={loading ? undefined : onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingCompat style={styles.avoider}>
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>{title}</Text>
              <TouchableOpacity onPress={onClose} disabled={loading} style={styles.closeBtn} accessibilityLabel="Close form">
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            <View style={styles.footer}>
              <Button title={submitLabel} onPress={onSubmit} loading={loading} fullWidth />
            </View>
          </View>
        </KeyboardAvoidingCompat>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  avoider: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 18 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 20, gap: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
});
