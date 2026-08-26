import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthActivateInvite } from '@workspace/api-client-react';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';

export default function ActivateScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const colors = useColors();

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
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Activate Account</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
            Enter the single-use activation token you received. You will then sign in with a mobile OTP.
          </Text>
        </View>

        {!!error && (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + '15', borderColor: colors.destructive + '30' }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive, fontFamily: 'Inter_500Medium' }]}>{error}</Text>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Input
            label="Activation Token"
            value={token}
            onChangeText={(t) => { setToken(t); setError(''); }}
            placeholder="Paste token here"
            leftIcon="key"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Input
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
            fullWidth 
            size="lg" 
            style={{ marginTop: 8 }}
          />
        </View>

        <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
          <Feather name="info" size={14} color={colors.textMuted} />
          <Text style={[styles.noticeText, { color: colors.textMuted, fontFamily: 'Inter_400Regular' }]}>
            This token is single-use and time-limited. Contact the shop owner if it has expired.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 24, flexGrow: 1 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },
  header: { gap: 8 },
  title: { fontSize: 28 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, gap: 16 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 12, padding: 12, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 12, padding: 16,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
});
