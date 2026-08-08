import sys

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

target = """export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, isLoading, loadError, loadAll, hasSampleData } = useData();
  const { data: approvalsData } = useApprovalsList();
  const { data: returnsData } = useReturnsList();
  const { data: refundsData } = useRefundsList();
  const pendingCount = approvalsData?.pendingCount || 0;
  const showApprovalsBadge = pendingCount > 0 && (user?.role === 'dealer' || user?.role === 'super_admin');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  };

  const hasAnyData = repairs.length > 0 || customers.length > 0 || inventory.length > 0 || finance.length > 0;

  const isDark = useIsDark();
  const today = getTodayStr();

  const stats = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().split('T')[0];

    const todayRepairs = repairs.filter(r => r.createdAt.startsWith(today));
    const yesterdayRepairs = repairs.filter(r => r.createdAt.startsWith(yesterday));
    
    const returnsList = returnsData?.returns || [];
    const refundsList = refundsData?.refunds || [];
    
    const todayReturns = returnsList.filter(r => r.createdAt.startsWith(today));
    const openReturns = returnsList.filter(r => r.status !== 'closed');
    const pendingRefunds = refundsData?.pendingCount || 0;
    const refundsPaid = refundsList.filter(rf => rf.status === 'paid').reduce((acc, rf) => acc + rf.amount, 0);

    const pending = repairs.filter(r => !['delivered', 'cancelled'].includes(r.status));
    const ready = repairs.filter(r => r.status === 'ready');
    const lowStock = inventory.filter(i => i.quantity <= i.minStock);
    
    const todayIncome = finance.filter(f => f.type === 'income' && f.date === today).reduce((s, f) => s + f.amount, 0);
    const todayExpense = finance.filter(f => f.type === 'expense' && f.date === today).reduce((s, f) => s + f.amount, 0);
    
    const yesterdayIncome = finance.filter(f => f.type === 'income' && f.date === yesterday).reduce((s, f) => s + f.amount, 0);
    const yesterdayExpense = finance.filter(f => f.type === 'expense' && f.date === yesterday).reduce((s, f) => s + f.amount, 0);

    return {
      todayRepairs: todayRepairs.length,
      yesterdayRepairs: yesterdayRepairs.length,
      pending: pending.length,
      ready: ready.length,
      lowStock: lowStock.length,
      todayIncome,
      yesterdayIncome,
      todayExpense,
      yesterdayExpense,
      todayReturns: todayReturns.length,
      openReturns: openReturns.length,
      pendingRefunds,
      refundsPaid
    };
  }, [repairs, inventory, finance, today, returnsData, refundsData]);

  const anims = useStaggerAnim(8);"""

new_content = """export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, isLoading, loadError, loadAll, hasSampleData } = useData();

  const { data: statsData, refetch: refetchStats } = useDashboardStats({ query: { queryKey: getDashboardStatsQueryKey() } });
  const dashboardStats = statsData?.stats;

  const [refreshing, setRefreshing] = useState(false);

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

  const anims = useStaggerAnim(8);"""

content = content.replace(target, new_content)

ui_target = """      {/* Main Stats */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Today's Overview</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <StatBox title="New Tickets" value={stats.todayRepairs} icon="inbox" color={colors.primary} animValue={anims[1]} />
          <StatBox title="In Progress" value={stats.pending} icon="tool" color={colors.warning} animValue={anims[2]} />
          <StatBox title="Ready" value={stats.ready} icon="check-circle" color={colors.success} animValue={anims[3]} />
          
          {(user?.role === 'dealer' || user?.role === 'super_admin') && pendingCount > 0 && (
            <StatBox title="Approvals" value={pendingCount} icon="shield" color={colors.destructive} animValue={anims[4]} />
          )}
          
          <StatBox title="Low Stock" value={stats.lowStock} icon="alert-triangle" color={colors.destructive} animValue={anims[5]} />
        </View>
      </View>

      {/* After-Sales Summary */}
      {(user?.role === 'dealer' || user?.role === 'super_admin' || user?.role === 'technician') && (stats.openReturns > 0 || stats.pendingRefunds > 0) && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>After-Sales & Returns</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '05' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Open Returns</Text>
                  <Text style={{ fontSize: 24, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{stats.openReturns}</Text>
                </View>
                <Feather name="refresh-ccw" size={20} color={colors.destructive} />
              </View>
            </GlassCard>
            {canAccess('finance') && (
              <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.warning + '33', backgroundColor: colors.warning + '05' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Pending Refunds</Text>
                    <Text style={{ fontSize: 24, color: colors.warning, fontFamily: 'Inter_700Bold' }}>{stats.pendingRefunds}</Text>
                  </View>
                  <Feather name="credit-card" size={20} color={colors.warning} />
                </View>
              </GlassCard>
            )}
          </View>
        </View>
      )}

      {/* Financial Snapshot */}
      {canAccess('finance') && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Financial Pulse</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.success + '33', backgroundColor: colors.success + '05' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Today's Income</Text>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.success + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="arrow-down-left" size={16} color={colors.success} />
                </View>
              </View>
              <Text style={{ fontSize: 24, color: colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(stats.todayIncome)}</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
                Yesterday: {formatCurrency(stats.yesterdayIncome)}
              </Text>
            </GlassCard>

            <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '05' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Today's Expense</Text>
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="arrow-up-right" size={16} color={colors.destructive} />
                </View>
              </View>
              <Text style={{ fontSize: 24, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{formatCurrency(stats.todayExpense)}</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4, fontFamily: 'Inter_400Regular' }}>
                Yesterday: {formatCurrency(stats.yesterdayExpense)}
              </Text>
            </GlassCard>
          </View>
        </View>
      )}"""

ui_new = """      {/* Main Stats Grid */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Overview</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <StatBox title="Received Today" value={dashboardStats?.todayRepairs || 0} icon="inbox" color={colors.primary} animValue={anims[1]} />
          <StatBox title="In Progress" value={dashboardStats?.pendingRepairs || 0} icon="tool" color={colors.warning} animValue={anims[2]} />
          <StatBox title="Ready for Pickup" value={dashboardStats?.readyForPickup || 0} icon="check-circle" color={colors.success} animValue={anims[3]} />
          <StatBox title="Total Customers" value={dashboardStats?.totalCustomers || 0} icon="users" color={colors.info} animValue={anims[4]} />
          
          {(user?.role === 'dealer' || user?.role === 'super_admin') && (dashboardStats?.openApprovalRequests || 0) > 0 && (
            <StatBox title="Open Approvals" value={dashboardStats?.openApprovalRequests} icon="shield" color={colors.destructive} animValue={anims[5]} />
          )}
          {(dashboardStats?.openReturnCases || 0) > 0 && (
            <StatBox title="Open Returns" value={dashboardStats?.openReturnCases} icon="refresh-ccw" color={colors.destructive} animValue={anims[5]} />
          )}
        </View>
      </View>

      {/* Financial Snapshot */}
      {dashboardStats?.canSeeFinance && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Today's Finances</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassCard style={{ flex: 1, padding: 20, borderColor: colors.success + '33', backgroundColor: colors.success + '05' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Income</Text>
                  <Text style={{ fontSize: 24, color: colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(dashboardStats.todayIncome || 0)}</Text>
                </View>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.success + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="trending-up" size={20} color={colors.success} />
                </View>
              </View>
            </GlassCard>
            <GlassCard style={{ flex: 1, padding: 20, borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '05' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Expense</Text>
                  <Text style={{ fontSize: 24, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{formatCurrency(dashboardStats.todayExpense || 0)}</Text>
                </View>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="trending-down" size={20} color={colors.destructive} />
                </View>
              </View>
            </GlassCard>
          </View>
          
          {((dashboardStats.pendingPayments || 0) > 0 || (dashboardStats.refundsTotal || 0) > 0) && (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              {(dashboardStats.pendingPayments || 0) > 0 && (
                <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.warning + '33', backgroundColor: colors.warning + '05' }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Pending Payments</Text>
                  <Text style={{ fontSize: 18, color: colors.warning, fontFamily: 'Inter_700Bold', marginTop: 4 }}>{formatCurrency(dashboardStats.pendingPayments || 0)}</Text>
                </GlassCard>
              )}
              {(dashboardStats.refundsToday || 0) > 0 && (
                <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '05' }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Refunds Today</Text>
                  <Text style={{ fontSize: 18, color: colors.destructive, fontFamily: 'Inter_700Bold', marginTop: 4 }}>{formatCurrency(dashboardStats.refundsToday || 0)}</Text>
                </GlassCard>
              )}
            </View>
          )}
        </View>
      )}"""

content = content.replace(ui_target, ui_new)
with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
    f.write(content)
