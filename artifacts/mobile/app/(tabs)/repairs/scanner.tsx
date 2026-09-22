import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, Platform, Alert } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { font } from '@/constants/typography';
import { layout, radius, size, space } from '@/constants/spacing';
import { useData } from '@/context/DataContext';

export default function ScannerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { repairs } = useData();

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      const getBarCodeScannerPermissions = async () => {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === 'granted');
      };
      getBarCodeScannerPermissions();
    }
  }, []);

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    setScanned(true);

    // First try direct ID
    let repair = repairs.find(r => r.id === data);

    // If not found, try matching ticket number
    if (!repair) {
      repair = repairs.find(r => r.repairId === data);
    }

    if (repair) {
      router.replace(`/(tabs)/repairs/${repair.id}`);
    } else {
      Alert.alert('Not Found', 'Could not find a repair for this QR code.', [
        { text: 'Try Again', onPress: () => setScanned(false) }
      ]);
    }
  };

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Feather name="camera-off" size={48} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
        <Text style={{ color: colors.foreground, ...font.heading, marginBottom: space.sm }}>Scanner Not Available</Text>
        <Text style={{ color: colors.mutedForeground, ...font.body, textAlign: 'center', marginBottom: space.xxl }}>
          The QR scanner requires the native mobile app. Please use the mobile app to scan device tags.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: space.xl, paddingVertical: space.md, backgroundColor: colors.primary, borderRadius: radius.sm }}>
          <Text style={{ color: colors.primaryForeground, ...font.button }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (hasPermission === null) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (hasPermission === false) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', padding: layout.screenPadding }]}>
        <Feather name="camera-off" size={size.avatarSm} color={colors.destructive} style={{ marginBottom: space.lg }} />
        <Text style={{ color: colors.foreground, ...font.heading, marginBottom: space.sm }}>No Camera Access</Text>
        <Text style={{ color: colors.mutedForeground, ...font.body, textAlign: 'center', marginBottom: space.xxl }}>
          Please enable camera permissions in your device settings to use the scanner.
        </Text>
        <TouchableOpacity onPress={() => router.back()} style={{ paddingHorizontal: space.xl, paddingVertical: space.md, backgroundColor: colors.primary, borderRadius: radius.sm }}>
          <Text style={{ color: colors.primaryForeground, ...font.button }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned as any}
      />

      <View style={[styles.overlay, { paddingTop: insets.top + space.lg, paddingHorizontal: layout.screenPadding }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TouchableOpacity onPress={() => router.back()} style={{ width: size.iconButton, height: size.iconButton, borderRadius: radius.pill, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={size.headerIcon} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 250, height: 250, borderWidth: 2, borderColor: colors.primary, backgroundColor: 'transparent', borderRadius: radius.md }}>
            <View style={{ position: 'absolute', top: -2, left: -2, width: 20, height: 20, borderTopWidth: 4, borderLeftWidth: 4, borderColor: colors.primary, borderTopLeftRadius: 16 }} />
            <View style={{ position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderTopWidth: 4, borderRightWidth: 4, borderColor: colors.primary, borderTopRightRadius: 16 }} />
            <View style={{ position: 'absolute', bottom: -2, left: -2, width: 20, height: 20, borderBottomWidth: 4, borderLeftWidth: 4, borderColor: colors.primary, borderBottomLeftRadius: 16 }} />
            <View style={{ position: 'absolute', bottom: -2, right: -2, width: 20, height: 20, borderBottomWidth: 4, borderRightWidth: 4, borderColor: colors.primary, borderBottomRightRadius: 16 }} />
          </View>
          <Text style={{ color: colors.foreground, ...font.label, marginTop: space.xxl, backgroundColor: colors.surfaceElevated, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill }}>
            Point camera at repair QR code
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
});
