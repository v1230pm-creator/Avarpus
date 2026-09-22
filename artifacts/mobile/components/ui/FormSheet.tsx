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
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';

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
          <View style={[styles.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
              <TouchableOpacity onPress={onClose} disabled={loading} style={styles.closeBtn} accessibilityLabel="Close form">
                <Feather name="x" size={24} color={colors.mutedForeground} />
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
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: '90%' },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: layout.screenPadding, paddingTop: space.xl, paddingBottom: space.lg, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: font.heading,
  closeBtn: { width: size.iconButton, height: size.iconButton, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  body: { padding: layout.screenPadding, gap: space.lg },
  footer: { paddingHorizontal: layout.screenPadding, paddingTop: space.sm },
});
