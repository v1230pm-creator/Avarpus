import React, { useMemo, useEffect, useRef, useState } from 'react';
import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  Animated,
  Easing,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { isDealerPortalRole } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard, useIsDark } from '@/components/ui/Glass';
import { DataLoadingState, DataErrorState, DataErrorBanner } from '@/components/ui/DataStates';
import { useAuth } from '@/context/AuthContext';
import { useData } from '@/context/DataContext';
import { useColors } from '@/hooks/useColors';
import { BarChart } from '@/components/charts/BarChart';
import { RepairStatusBadge, PriorityBadge, SampleBadge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { formatCurrency, formatDate, getGreeting, getTodayStr, ROLE_LABELS } from '@/utils/helpers';
import { useDashboardStats, getDashboardStatsQueryKey } from '@workspace/api-client-react';

// --- Shared Helper ---
const getStatusColor = (status: string, colors: any) => {
  const map: Record<string, string> = {
    received: colors.statusReceived,
    diagnosing: colors.statusDiagnosing,
    waiting_parts: colors.statusWaitingParts,
    repairing: colors.statusRepairing,
    testing: colors.statusTesting,
    ready: colors.statusReady,
    delivered: colors.statusDelivered,
    cancelled: colors.statusCancelled,
  };
  return map[status] || colors.primary;
};

// --- Components ---

const Header = () => {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  
  const [timeStr, setTimeStr] = useState('');
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }));
    };
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, []);

  const topPad = Platform.OS === 'web' ? insets.top + 67 : Math.max(insets.top, 20);

  return (
    <View style={{ paddingTop: topPad + 16, paddingHorizontal: 20, paddingBottom: 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Feather name="sun" size={14} color={colors.primary} />
            <Text style={{ fontSize: 12, color: colors.primary, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {getGreeting()} • {timeStr}
            </Text>
          </View>
          <Text style={{ fontSize: 28, color: colors.foreground, fontFamily: 'Inter_700Bold', lineHeight: 34 }}>
            {user?.name?.split(' ')[0] || 'Dealer'}
          </Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 4 }}>
            {ROLE_LABELS[user?.role ?? 'reception']} • VMC Electronics
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity style={{ 
            width: 44, height: 44, borderRadius: 22, 
            backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
            alignItems: 'center', justifyContent: 'center' 
          }}>
            <Feather name="bell" size={20} color={colors.foreground} />
            <View style={{ position: 'absolute', top: 10, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.destructive, borderWidth: 2, borderColor: colors.card }} />
          </TouchableOpacity>
          <Avatar name={user?.name ?? 'User'} size={44} variant="glass" />
        </View>
      </View>
    </View>
  );
};

const QuickActions = () => {
  const colors = useColors();
  const router = useRouter();
  const { canAccess } = useAuth();
  
  const actions = [
    { id: 'customer', icon: 'user-plus', label: 'Add Customer', path: '/(tabs)/customers', color: colors.info, req: 'customers' },
    { id: 'inventory', icon: 'package', label: 'Add Product', path: '/(tabs)/inventory', color: colors.warning, req: 'inventory' },
    { id: 'finance', icon: 'bar-chart-2', label: 'Finance', path: '/(tabs)/more/finance', color: colors.success, req: 'finance' },
  ];

  const allowed = actions.filter(a => canAccess(a.req));

  return (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false} 
      contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 8 }}
    >
      {allowed.map((a) => (
        <TouchableOpacity key={a.id} onPress={() => router.push(a.path as any)} activeOpacity={0.7}>
          <View style={{ 
            backgroundColor: colors.glass,
            borderWidth: 1, borderColor: colors.glassBorder,
            borderRadius: 18,
            padding: 16,
            alignItems: 'center', justifyContent: 'center',
            width: 105,
            shadowColor: '#000000', shadowOpacity: 0.14, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
            elevation: 2,
          }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: a.color + '15', borderWidth: 1, borderColor: a.color + '2E', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
              <Feather name={a.icon as any} size={20} color={a.color} />
            </View>
            <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: 'Inter_600SemiBold', textAlign: 'center' }}>
              {a.label}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

const StatBox = ({ title, value, icon, trend, color, animValue, isCurrency }: any) => {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const numCols = width > 768 ? 4 : 2;
  const gap = 12;
  const cardWidth = (width - 40 - (gap * (numCols - 1))) / numCols;

  return (
    <GlassCard animValue={animValue} style={{ width: cardWidth, padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ 
          width: 36, height: 36, borderRadius: 12, 
          backgroundColor: color + '15',
          alignItems: 'center', justifyContent: 'center'
        }}>
          <Feather name={icon} size={18} color={color} />
        </View>
        {trend !== undefined && trend !== 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: trend > 0 ? colors.success + '15' : colors.destructive + '15', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 }}>
            <Feather name={trend > 0 ? "arrow-up-right" : "arrow-down-right"} size={12} color={trend > 0 ? colors.success : colors.destructive} />
            <Text style={{ fontSize: 11, color: trend > 0 ? colors.success : colors.destructive, fontFamily: 'Inter_600SemiBold' }}>
              {Math.abs(trend)}
            </Text>
          </View>
        )}
      </View>
      <View>
        <Text style={{ fontSize: 24, color: colors.foreground, fontFamily: 'Inter_700Bold' }} numberOfLines={1} adjustsFontSizeToFit>
          {isCurrency ? formatCurrency(value as number) : value}
        </Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginTop: 4 }}>
          {title}
        </Text>
      </View>
    </GlassCard>
  );
};

const PipelineCard = ({ animValue }: any) => {
  const colors = useColors();
  const { repairs } = useData();

  const counts = useMemo(() => ({
    received: repairs.filter(r => r.status === 'received').length,
    inRepair: repairs.filter(r => ['diagnosing', 'waiting_parts', 'repairing', 'testing', 'cannot_repair', 'customer_approval'].includes(r.status)).length,
    ready: repairs.filter(r => r.status === 'ready').length,
    delivered: repairs.filter(r => r.status === 'delivered').length,
  }), [repairs]);

  const totalActive = counts.received + counts.inRepair + counts.ready;
  const safeTotal = totalActive || 1;

  const stages = [
    { label: 'Received', key: 'received', color: colors.statusReceived, count: counts.received },
    { label: 'In Repair', key: 'inRepair', color: colors.statusDiagnosing, count: counts.inRepair },
    { label: 'Ready for Delivery', key: 'ready', color: colors.statusReady, count: counts.ready },
  ];

  return (
    <GlassCard animValue={animValue} style={{ width: '100%', padding: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text style={{ fontSize: 15, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
          Active Pipeline
        </Text>
        <View style={{ backgroundColor: colors.success + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
          <Text style={{ fontSize: 11, color: colors.success, fontFamily: 'Inter_600SemiBold' }}>
            {counts.delivered} Delivered
          </Text>
        </View>
      </View>
      
      <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.muted, marginBottom: 20 }}>
        {stages.map((s, i) => {
          const widthPct = (s.count / safeTotal) * 100;
          if (widthPct === 0) return null;
          return <View key={s.key} style={{ width: `${widthPct}%`, backgroundColor: s.color, borderRightWidth: i < stages.length - 1 ? 2 : 0, borderColor: colors.card }} />
        })}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {stages.map(s => (
          <View key={s.key} style={{ alignItems: 'flex-start', flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{s.count}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>{s.label}</Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
};

const TimelineItem = ({ repair, isLast, router, colors }: any) => {
  const statusColor = getStatusColor(repair.status, colors);

  return (
    <TouchableOpacity 
      activeOpacity={0.7} 
      onPress={() => router.push(`/(tabs)/repairs/${repair.id}`)}
      style={{ flexDirection: 'row', minHeight: 64 }}
    >
      <View style={{ width: 28, alignItems: 'center' }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor, marginTop: 4, zIndex: 1 }} />
        {!isLast && <View style={{ width: 2, flex: 1, backgroundColor: colors.border, marginTop: -4, marginBottom: -8 }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: 24, paddingTop: 0 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
          <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
            {repair.customerName}
          </Text>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            {formatDate(repair.createdAt)}
          </Text>
        </View>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 10 }}>
          {repair.brand} {repair.model}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <RepairStatusBadge status={repair.status} />
          <PriorityBadge priority={repair.priority} />
          {repair.isSample && <SampleBadge />}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const QuickActionFAB = () => {
  const colors = useColors();
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { canAccess } = useAuth();
  const insets = useSafeAreaInsets();

  const toggleAnim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    Animated.spring(toggleAnim, {
      toValue: next ? 1 : 0,
      useNativeDriver: true,
      friction: 6,
      tension: 40,
    }).start();
  };

  const spin = toggleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg']
  });
  
  const actions = [
    { id: 'customer', icon: 'user-plus', label: 'Add Customer', path: '/(tabs)/customers', color: colors.info, req: 'customers' },
    { id: 'inventory', icon: 'package', label: 'Add Product', path: '/(tabs)/inventory', color: colors.warning, req: 'inventory' },
  ].filter(a => canAccess(a.req));

  const bottomPos = Platform.OS === 'web' ? 100 : insets.bottom + 70;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', bottom: bottomPos, right: 20, alignItems: 'flex-end', zIndex: 1000, elevation: 10 }}>
      {actions.map((act, index) => {
        const translateY = toggleAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -((index + 1) * 60)]
        });
        const scale = toggleAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.5, 1]
        });
        const opacity = toggleAnim.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, 0, 1]
        });

        return (
          <Animated.View key={act.id} pointerEvents={isOpen ? 'auto' : 'none'} style={{ 
            position: 'absolute', right: 4, bottom: 4,
            opacity,
            transform: [{ translateY }, { scale }],
            flexDirection: 'row', alignItems: 'center', gap: 12
          }}>
            <Text style={{ 
              backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 6, 
              borderRadius: 12, overflow: 'hidden',
              fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground,
              borderWidth: 1, borderColor: colors.border
            }}>
              {act.label}
            </Text>
            <TouchableOpacity 
              activeOpacity={0.8}
              onPress={() => { toggle(); router.push(act.path as any); }}
              style={{
                width: 48, height: 48, borderRadius: 24,
                backgroundColor: colors.card,
                borderWidth: 1, borderColor: colors.border,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: colors.foreground, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
                elevation: 4
              }}
            >
              <Feather name={act.icon as any} size={20} color={act.color} />
            </TouchableOpacity>
          </Animated.View>
        )
      })}
      
      <TouchableOpacity activeOpacity={0.8} onPress={toggle} style={{ shadowColor: '#000000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
        <View
          style={{
            width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.blueBright,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
          }}
        >
          <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Feather name="plus" size={24} color="#FFFFFF" />
          </Animated.View>
        </View>
      </TouchableOpacity>
    </View>
  );
};

// Shown when the shop has no data at all: lets a new dealer explore the app
// with clearly-labelled, one-tap-removable sample data.
const EmptyShopState = () => {
  const colors = useColors();
  const { loadSampleData } = useData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      await loadSampleData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load sample data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
      <GlassCard style={{ width: '100%', padding: 24, alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Feather name="inbox" size={26} color={colors.primary} />
        </View>
        <Text style={{ fontSize: 17, color: colors.foreground, fontFamily: 'Inter_700Bold', marginBottom: 6 }}>
          Your shop is empty
        </Text>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19, marginBottom: 18 }}>
          Add your first repair or customer — or load sample data to explore the dashboard, reports and lists. Sample data is clearly labelled and can be removed anytime with one tap.
        </Text>
        <TouchableOpacity
          onPress={onLoad}
          disabled={loading}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: colors.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
            opacity: loading ? 0.7 : 1,
          }}
        >
          <Feather name={loading ? 'loader' : 'database'} size={16} color="#FFFFFF" />
          <Text style={{ fontSize: 14, color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>
            {loading ? 'Loading sample data…' : 'Load sample data'}
          </Text>
        </TouchableOpacity>
        {!!error && (
          <Text style={{ fontSize: 12, color: colors.destructive, fontFamily: 'Inter_500Medium', marginTop: 10, textAlign: 'center' }}>
            {error}
          </Text>
        )}
      </GlassCard>
    </View>
  );
};

// Banner shown while sample data is loaded, with a one-tap clear.
const SampleDataBanner = () => {
  const colors = useColors();
  const { clearSampleData } = useData();
  const [clearing, setClearing] = useState(false);

  const onClear = async () => {
    setClearing(true);
    try {
      await clearSampleData();
    } catch {
      // Non-fatal — the banner stays and the user can retry.
    } finally {
      setClearing(false);
    }
  };

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: colors.warning + '15', borderWidth: 1, borderColor: colors.warning + '33',
      padding: 12, borderRadius: 14,
    }}>
      <Feather name="database" size={16} color={colors.warning} />
      <Text style={{ flex: 1, fontSize: 12, color: colors.foreground, fontFamily: 'Inter_500Medium', lineHeight: 17 }}>
        You're viewing sample data. Clear it anytime — your real records won't be touched.
      </Text>
      <TouchableOpacity
        onPress={onClear}
        disabled={clearing}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.warning + '55', backgroundColor: colors.warning + '11' }}
      >
        <Text style={{ fontSize: 12, color: colors.warning, fontFamily: 'Inter_600SemiBold' }}>
          {clearing ? 'Clearing…' : 'Clear'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// --- Main Screen ---

export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, isLoading, loadError, loadAll, hasSampleData } = useData();

  const { data: statsData, refetch: refetchStats } = useDashboardStats({ query: { queryKey: getDashboardStatsQueryKey() } });
  const dashboardStats = statsData?.stats;

  const [refreshing, setRefreshing] = useState(false);

  // Dealer-portal accounts have no dashboard — their home is My Repairs.
  // (Placed after all hooks to respect the rules of hooks.)
  if (isDealerPortalRole(user?.role)) {
    return <Redirect href="/(tabs)/repairs" />;
  }

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
      await refetchStats();
    } finally {
      setRefreshing(false);
    }
  };

  const hasAnyData = repairs.length > 0 || customers.length > 0 || inventory.length > 0 || finance.length > 0;

  const isDark = useIsDark();
  const today = getTodayStr();

  // For charts
  const stats = useMemo(() => {
    const lowStock = inventory.filter(i => i.quantity <= i.minStock);
    return {
      lowStock: lowStock.length,
    };
  }, [inventory]);

  const cardAnims = useRef([...Array(15)].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.stagger(60, cardAnims.map(anim => 
      Animated.timing(anim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic)
      })
    )).start();
  }, [cardAnims]);

  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split('T')[0];
      const label = d.toLocaleDateString('en-IN', { weekday: 'short' }).substring(0, 3);
      const count = repairs.filter((r) => r.createdAt.startsWith(key)).length;
      return { label, value: count };
    });
  }, [repairs]);

  const recentRepairs = useMemo(
    () => [...repairs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [repairs],
  );

  const tips = useMemo(() => [
    "Follow up on pending estimates — quick replies win more approvals.",
    "Update repair statuses promptly so customers always know where things stand.",
    "Review low stock items regularly to avoid delays on active repairs.",
    "A quick call after delivery goes a long way toward repeat customers."
  ], []);
  const tip = useMemo(() => tips[Math.floor(Math.random() * tips.length)], [tips]);

  const showFinance = canAccess('finance');
  const showRepairs = canAccess('repairs');
  const isTechnician = user?.role === 'technician';

  // Technician "My Work" — counts over repairs assigned to this technician.
  const techStats = useMemo(() => {
    if (!isTechnician || !user?.id) return null;
    const mine = repairs.filter(r => r.technicianId === user.id);
    return {
      assigned: mine.filter(r => !['delivered', 'cancelled'].includes(r.status)).length,
      repairing: mine.filter(r => ['diagnosing', 'waiting_parts', 'repairing'].includes(r.status)).length,
      testing: mine.filter(r => r.status === 'testing').length,
      approval: mine.filter(r => r.status === 'customer_approval').length,
      cannotRepair: mine.filter(r => r.status === 'cannot_repair').length,
      ready: mine.filter(r => r.status === 'ready').length,
      completed: mine.filter(r => r.status === 'delivered').length,
    };
  }, [isTechnician, user?.id, repairs]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {isDark && (
          <LinearGradient
            colors={['#0B0F1A', '#0E1422']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        )}
        <View style={{ position: 'absolute', top: -120, right: -120, width: 320, height: 320, borderRadius: 160, backgroundColor: isDark ? colors.blueBright : colors.primary, opacity: isDark ? 0.08 : 0.04, transform: [{ scale: 1.5 }] }} />
      </View>

      {isLoading && !hasAnyData ? (
        <>
          <Header />
          <DataLoadingState />
        </>
      ) : loadError && !hasAnyData ? (
        <>
          <Header />
          <DataErrorState onRetry={loadAll} />
        </>
      ) : (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Header />

        {!!loadError && <DataErrorBanner onRetry={loadAll} />}

        <Animated.View style={{ opacity: cardAnims[0], transform: [{ translateY: cardAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
          <QuickActions />
        </Animated.View>

        {!hasAnyData && !isLoading && !loadError && <EmptyShopState />}

        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 20 }}>
          {(user?.role === 'dealer' || user?.role === 'super_admin') && (dashboardStats?.openApprovalRequests || 0) > 0 && (
            <Animated.View style={{ opacity: cardAnims[0], transform: [{ translateY: cardAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more/approvals')}
                activeOpacity={0.8}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.glass, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: colors.destructive + '33' }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check-circle" size={20} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>Pending Approvals</Text>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>You have {dashboardStats!.openApprovalRequests} backdated request{dashboardStats!.openApprovalRequests === 1 ? '' : 's'} waiting for approval.</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.destructive} />
              </TouchableOpacity>
            </Animated.View>
          )}

          {hasSampleData && <SampleDataBanner />}
          
          <Animated.View style={{ opacity: cardAnims[1], transform: [{ translateY: cardAnims[1].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: isDark ? colors.glass : colors.primary + '11', padding: 16, borderRadius: 18, borderWidth: 1, borderColor: isDark ? colors.glassBorder : colors.primary + '22' }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary + '22', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="zap" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>Daily Tip</Text>
                <Text style={{ fontSize: 13, color: colors.foreground, fontFamily: 'Inter_500Medium', lineHeight: 18 }}>{tip}</Text>
              </View>
            </View>
          </Animated.View>

          {showRepairs && (
            <PipelineCard animValue={cardAnims[2]} />
          )}

          {techStats && (
            <Animated.View style={{ opacity: cardAnims[2], transform: [{ translateY: cardAnims[2].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }}>My Work</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <StatBox title="Assigned to Me" value={techStats.assigned} icon="tool" color={colors.primary} animValue={cardAnims[3]} />
                <StatBox title="Repairing" value={techStats.repairing} icon="settings" color={colors.statusDiagnosing} animValue={cardAnims[4]} />
                <StatBox title="Testing" value={techStats.testing} icon="activity" color={colors.info} animValue={cardAnims[5]} />
                <StatBox title="Approval Needed" value={techStats.approval} icon="help-circle" color={colors.warning} animValue={cardAnims[6]} />
                <StatBox title="Cannot Repair" value={techStats.cannotRepair} icon="x-circle" color={colors.destructive} animValue={cardAnims[7]} />
                <StatBox title="Ready for Pickup" value={techStats.ready} icon="check-circle" color={colors.statusReady} animValue={cardAnims[8]} />
                <StatBox title="Completed" value={techStats.completed} icon="package" color={colors.statusDelivered} animValue={cardAnims[9]} />
              </View>
            </Animated.View>
          )}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {showRepairs && (
              <>
                <StatBox title="Received Today" value={dashboardStats?.todayRepairs || 0} icon="inbox" color={colors.primary} animValue={cardAnims[3]} />
                <StatBox title="In Repair" value={dashboardStats?.pendingRepairs || 0} icon="tool" color={colors.statusDiagnosing} animValue={cardAnims[4]} />
                <StatBox title="Ready for Delivery" value={dashboardStats?.readyForPickup || 0} icon="check-circle" color={colors.statusReady} animValue={cardAnims[5]} />
                <StatBox title="Delivered" value={repairs.filter(r => r.status === 'delivered').length} icon="package" color={colors.statusDelivered} animValue={cardAnims[6]} />
                <StatBox title="After-Sales Cases" value={dashboardStats?.openReturnCases || 0} icon="corner-up-left" color={colors.warning} animValue={cardAnims[7]} />
              </>
            )}
            
            {showFinance && dashboardStats?.canSeeFinance && (
              <>
                <StatBox title="Today's Sales" value={dashboardStats?.todayIncome || 0} icon="trending-up" color={colors.success} animValue={cardAnims[9]} isCurrency />
                <StatBox title="Today's Expense" value={dashboardStats?.todayExpense || 0} icon="trending-down" color={colors.destructive} animValue={cardAnims[10]} isCurrency />
                <StatBox title="Pending Payments" value={dashboardStats?.pendingPayments || 0} icon="credit-card" color={colors.warning} animValue={cardAnims[11]} isCurrency />
                {((dashboardStats?.refundsToday || 0) > 0) && (
                  <StatBox title="Refunds Today" value={dashboardStats?.refundsToday || 0} icon="dollar-sign" color={colors.destructive} animValue={cardAnims[8]} isCurrency />
                )}
              </>
            )}
            
            <StatBox title="Low Stock Items" value={stats.lowStock} icon="alert-triangle" color={stats.lowStock > 0 ? colors.destructive : colors.success} animValue={cardAnims[12]} />
            
            {canAccess('customers') && (
              <StatBox title="Total Customers" value={dashboardStats?.totalCustomers || 0} icon="users" color={colors.info} animValue={cardAnims[13]} />
            )}
            {canAccess('inventory') && (
              <StatBox title="Total Products" value={inventory.length} icon="package" color={colors.primary} animValue={cardAnims[14]} />
            )}
          </View>

          {showRepairs && (
            <GlassCard animValue={cardAnims[12]} style={{ width: '100%', padding: 20 }}>
              <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>
                Weekly Repairs
              </Text>
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_400Regular', marginBottom: 16 }}>
                Activity over the last 7 days
              </Text>
              <BarChart data={weeklyData} color={colors.primary} height={140} />
            </GlassCard>
          )}

          {showRepairs && (
            <GlassCard animValue={cardAnims[13]} style={{ width: '100%', padding: 20 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                  Recent Activity
                </Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/repairs')}>
                  <Text style={{ fontSize: 13, color: colors.primary, fontFamily: 'Inter_500Medium' }}>View All</Text>
                </TouchableOpacity>
              </View>

              {recentRepairs.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 12 }}>
                  No recent activity
                </Text>
              ) : (
                recentRepairs.map((repair, i) => (
                  <TimelineItem key={repair.id} repair={repair} isLast={i === recentRepairs.length - 1} router={router} colors={colors} />
                ))
              )}
            </GlassCard>
          )}
        </View>
      </ScrollView>
      )}

      <QuickActionFAB />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
