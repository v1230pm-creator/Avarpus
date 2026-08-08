import sys

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

import_target = "import { useApprovalsList, useReturnsList, useRefundsList } from '@workspace/api-client-react';"
import_new = "import { useDashboardStats, getDashboardStatsQueryKey } from '@workspace/api-client-react';"

content = content.replace(import_target, import_new)

main_target = """export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory } = useData();

  // --- Derived Data ---
  const today = getTodayStr();

  const repairsToday = useMemo(() => 
    repairs.filter(r => r.receiveDate.startsWith(today)).length
  , [repairs, today]);

  const pendingCount = useMemo(() => 
    repairs.filter(r => ['received', 'diagnosing', 'waiting_parts', 'repairing', 'testing'].includes(r.status)).length
  , [repairs]);

  const readyCount = useMemo(() => 
    repairs.filter(r => r.status === 'ready').length
  , [repairs]);

  const { data: approvalsData } = useApprovalsList();
  const pendingApprovals = useMemo(() => 
    approvalsData?.approvals?.filter(a => a.status === 'pending').length || 0
  , [approvalsData]);

  const { data: returnsData } = useReturnsList();
  const openReturns = useMemo(() => 
    returnsData?.returns?.filter(r => r.status === 'open').length || 0
  , [returnsData]);

  // Finance
  const todayIncome = useMemo(() => {
    return repairs
      .filter(r => r.status === 'delivered' && r.deliveryDate?.startsWith(today))
      .reduce((sum, r) => sum + r.repairCharge + r.partsCharge, 0);
  }, [repairs, today]);

  // Animations"""

main_new = """export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user, canAccess } = useAuth();

  const { data: statsData, isLoading, refetch } = useDashboardStats({ query: { queryKey: getDashboardStatsQueryKey() } });
  const stats = statsData?.stats;

  // Animations"""

content = content.replace(main_target, main_new)

stats_target = """      {/* Main Stats Grid */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Overview</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <StatBox title="Received Today" value={repairsToday} icon="inbox" color={colors.primary} animValue={anims[1]} />
          <StatBox title="In Progress" value={pendingCount} icon="tool" color={colors.warning} animValue={anims[2]} />
          <StatBox title="Ready for Pickup" value={readyCount} icon="check-circle" color={colors.success} animValue={anims[3]} />
          <StatBox title="Total Customers" value={customers.length} icon="users" color={colors.info} animValue={anims[4]} />
          
          {(user?.role === 'dealer' || user?.role === 'super_admin') && pendingApprovals > 0 && (
            <StatBox title="Open Approvals" value={pendingApprovals} icon="shield" color={colors.destructive} animValue={anims[5]} />
          )}
          {openReturns > 0 && (
            <StatBox title="Open Returns" value={openReturns} icon="refresh-ccw" color={colors.destructive} animValue={anims[5]} />
          )}
        </View>
      </View>

      {/* Financial Snapshot */}
      {canAccess('finance') && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Today's Revenue</Text>
          <GlassCard style={{ padding: 20, borderColor: colors.success + '33', backgroundColor: colors.success + '05' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View>
                <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Completed & Paid Today</Text>
                <Text style={{ fontSize: 32, color: colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(todayIncome)}</Text>
              </View>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.success + '22', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="trending-up" size={24} color={colors.success} />
              </View>
            </View>
          </GlassCard>
        </View>
      )}"""

stats_new = """      {/* Main Stats Grid */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Overview</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          <StatBox title="Received Today" value={stats?.todayRepairs || 0} icon="inbox" color={colors.primary} animValue={anims[1]} />
          <StatBox title="In Progress" value={stats?.pendingRepairs || 0} icon="tool" color={colors.warning} animValue={anims[2]} />
          <StatBox title="Ready for Pickup" value={stats?.readyForPickup || 0} icon="check-circle" color={colors.success} animValue={anims[3]} />
          <StatBox title="Total Customers" value={stats?.totalCustomers || 0} icon="users" color={colors.info} animValue={anims[4]} />
          
          {(user?.role === 'dealer' || user?.role === 'super_admin') && (stats?.openApprovalRequests || 0) > 0 && (
            <StatBox title="Open Approvals" value={stats?.openApprovalRequests} icon="shield" color={colors.destructive} animValue={anims[5]} />
          )}
          {(stats?.openReturnCases || 0) > 0 && (
            <StatBox title="Open Returns" value={stats?.openReturnCases} icon="refresh-ccw" color={colors.destructive} animValue={anims[5]} />
          )}
        </View>
      </View>

      {/* Financial Snapshot */}
      {stats?.canSeeFinance && (
        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Today's Finances</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <GlassCard style={{ flex: 1, padding: 20, borderColor: colors.success + '33', backgroundColor: colors.success + '05' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium', marginBottom: 4 }}>Income</Text>
                  <Text style={{ fontSize: 24, color: colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(stats.todayIncome || 0)}</Text>
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
                  <Text style={{ fontSize: 24, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{formatCurrency(stats.todayExpense || 0)}</Text>
                </View>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="trending-down" size={20} color={colors.destructive} />
                </View>
              </View>
            </GlassCard>
          </View>
          
          {((stats.pendingPayments || 0) > 0 || (stats.refundsTotal || 0) > 0) && (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              {(stats.pendingPayments || 0) > 0 && (
                <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.warning + '33', backgroundColor: colors.warning + '05' }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Pending Payments</Text>
                  <Text style={{ fontSize: 18, color: colors.warning, fontFamily: 'Inter_700Bold', marginTop: 4 }}>{formatCurrency(stats.pendingPayments || 0)}</Text>
                </GlassCard>
              )}
              {(stats.refundsToday || 0) > 0 && (
                <GlassCard style={{ flex: 1, padding: 16, borderColor: colors.destructive + '33', backgroundColor: colors.destructive + '05' }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>Refunds Today</Text>
                  <Text style={{ fontSize: 18, color: colors.destructive, fontFamily: 'Inter_700Bold', marginTop: 4 }}>{formatCurrency(stats.refundsToday || 0)}</Text>
                </GlassCard>
              )}
            </View>
          )}
        </View>
      )}"""

content = content.replace(stats_target, stats_new)

refresh_target = """        refreshControl={
          <RefreshControl refreshing={false} onRefresh={() => {}} tintColor={colors.primary} />
        }"""
refresh_new = """        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />
        }"""

content = content.replace(refresh_target, refresh_new)

with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
    f.write(content)
