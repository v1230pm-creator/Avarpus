import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthActivateInvite } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { onBlue } from '@/constants/brand';
import { font, fontFamily } from '@/constants/typography';

export default function ActivateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = {
    bg: onBlue.background,
    card: onBlue.surface,
    border: onBlue.surfaceBorder,
    text: onBlue.text,
    textMuted: onBlue.textMuted,
    danger: onBlue.danger,
    dangerBg: onBlue.noticeBackground,
    infoBg: onBlue.noticeBackground,
  };

  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const activateMutation = useAuthActivateInvite();

  const handleActivate = async () => {
    if (!token.trim()) { setError('Please enter the activation token.'); return; }
    if (!name.trim()) { setError('Please enter your name.'); return; }
    setError('');

    activateMutation.mutate(
      { data: { token: token.trim(), name: name.trim() } },
      {
        onSuccess: () => {
          router.replace('/(auth)/phone');
        },
        onError: (err: any) => {
          setError(err?.data?.message ?? err?.message ?? 'Activation failed. The token may be invalid or expired.');
        },
      },
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.bg }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.text, fontFamily: fontFamily.bold }]}>Activate Account</Text>
          <Text style={[styles.subtitle, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>
            Enter the single-use activation token you received. You will then sign in with a mobile OTP.
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: theme.dangerBg, borderColor: theme.dangerBg }]}>
            <Feather name="alert-circle" size={14} color={theme.danger} />
            <Text style={[styles.errorText, { color: theme.danger, fontFamily: fontFamily.medium }]}>{error}</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Input
            onBlue
            label="Activation Token"
            value={token}
            onChangeText={(t) => { setToken(t); setError(''); }}
            placeholder="Paste token here"
            leftIcon="key"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Input
            onBlue
            label="Full Name"
            value={name}
            onChangeText={(t) => { setName(t); setError(''); }}
            placeholder="Your full name"
            leftIcon="user"
            autoCapitalize="words"
          />
          <Button 
            title="Activate & Continue" 
            onPress={handleActivate} 
            loading={activateMutation.isPending} 
            variant="onBlue"
            fullWidth 
            size="lg" 
            style={{ marginTop: 8 }}
          />
        </View>

        <View style={[styles.notice, { backgroundColor: theme.infoBg }]}>
          <Feather name="info" size={14} color={theme.textMuted} />
          <Text style={[styles.noticeText, { color: theme.textMuted, fontFamily: fontFamily.regular }]}>
            This token is single-use and time-limited. Contact the shop owner if it has expired.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 16, flexGrow: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  header: { gap: 6 },
  title: { ...font.title },
  subtitle: { ...font.small },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 12 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 8, padding: 10, borderWidth: 1,
  },
  errorText: { flex: 1, ...font.small },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, padding: 14,
  },
  noticeText: { flex: 1, ...font.small },
});
