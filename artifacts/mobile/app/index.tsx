import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { isLockEnabled, isUnlocked } from '@/utils/appLock';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const colors = useColors();
  const [lockCheck, setLockCheck] = useState<'pending' | 'locked' | 'open'>('pending');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const locked = (await isLockEnabled()) && !isUnlocked();
        if (active) setLockCheck(locked ? 'locked' : 'open');
      } catch {
        if (active) setLockCheck('locked');
      }
    })();
    return () => { active = false; };
  }, []);

  if (isLoading || lockCheck === 'pending') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  if (lockCheck === 'locked') {
    return <Redirect href="/(auth)/biometric" />;
  }

  return <Redirect href="/(tabs)" />;
}
