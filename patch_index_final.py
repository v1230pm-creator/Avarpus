import sys
import re

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

# First replace the entire stats grid and after sales blocks which still use old stats
grid_target_start = content.find("        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 20 }}>")
grid_target_end = content.find("        <View style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 100 }}>")

if grid_target_start != -1 and grid_target_end != -1:
    old_grid = content[grid_target_start:grid_target_end]
    new_grid = """        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 20 }}>
          {dashboardStats?.openApprovalRequests ? (
            <Animated.View style={{ opacity: cardAnims[0], transform: [{ translateY: cardAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more/approvals')}
                activeOpacity={0.8}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.destructive + '15', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.destructive + '33' }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="shield" size={20} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, color: colors.destructive, fontFamily: 'Inter_700Bold', marginBottom: 2 }}>Approvals Required</Text>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>You have {dashboardStats.openApprovalRequests} backdated request{dashboardStats.openApprovalRequests === 1 ? '' : 's'} waiting for approval.</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.destructive} />
              </TouchableOpacity>
            </Animated.View>
          ) : null}

          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Today's Snapshot</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <StatBox title="New Tickets" value={dashboardStats?.todayRepairs || 0} icon="inbox" color={colors.primary} animValue={cardAnims[1]} />
              <StatBox title="In Progress" value={dashboardStats?.pendingRepairs || 0} icon="tool" color={colors.warning} animValue={cardAnims[2]} />
              <StatBox title="Ready for Pickup" value={dashboardStats?.readyForPickup || 0} icon="check-circle" color={colors.success} animValue={cardAnims[3]} />
            </View>
          </View>

          {canAccess('finance') && dashboardStats?.canSeeFinance && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Financial Pulse</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <StatBox title="Today's Sales" value={dashboardStats?.todayIncome || 0} icon="trending-up" color={colors.success} animValue={cardAnims[9]} isCurrency />
                <StatBox title="Today's Expense" value={dashboardStats?.todayExpense || 0} icon="trending-down" color={colors.destructive} animValue={cardAnims[10]} isCurrency />
                <StatBox title="Pending Payments" value={dashboardStats?.pendingPayments || 0} icon="credit-card" color={colors.warning} animValue={cardAnims[11]} isCurrency />
              </View>
            </View>
          )}

          {(user?.role === 'dealer' || user?.role === 'super_admin' || user?.role === 'technician') && (
            <View>
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>After-Sales</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                <StatBox title="Open Returns" value={dashboardStats?.openReturnCases || 0} icon="corner-up-left" color={colors.warning} animValue={cardAnims[7]} />
                {canAccess('finance') && dashboardStats?.canSeeFinance && (dashboardStats?.refundsToday || 0) > 0 && (
                  <StatBox title="Refunds Today" value={dashboardStats?.refundsToday || 0} icon="dollar-sign" color={colors.destructive} animValue={cardAnims[8]} isCurrency />
                )}
              </View>
            </View>
          )}

          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }]}>Database</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              <StatBox title="Total Customers" value={dashboardStats?.totalCustomers || 0} icon="users" color={colors.info} animValue={cardAnims[13]} />
              <StatBox title="Low Stock Products" value={stats.lowStock} icon="alert-triangle" color={colors.destructive} animValue={cardAnims[14]} />
            </View>
          </View>
        </View>
"""
    content = content[:grid_target_start] + new_grid + content[grid_target_end:]
    with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
        f.write(content)
else:
    print("Not found")

