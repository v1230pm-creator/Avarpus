import sys

with open('artifacts/mobile/app/(tabs)/index.tsx', 'r') as f:
    content = f.read()

target = """        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 20 }}>
          {showApprovalsBadge && (
            <Animated.View style={{ opacity: cardAnims[0], transform: [{ translateY: cardAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more/approvals')}
                activeOpacity={0.8}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.destructive + '15', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.destructive + '33' }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.destructive + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="check-circle" size={20} color={colors.destructive} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 2 }}>Pending Approvals</Text>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>You have {pendingCount} backdated request{pendingCount === 1 ? '' : 's'} waiting for approval.</Text>
                </View>
                <Feather name="chevron-right" size={20} color={colors.destructive} />
              </TouchableOpacity>
            </Animated.View>
          )}

          {hasSampleData && <SampleDataBanner />}
          
          <Animated.View style={{ opacity: cardAnims[1], transform: [{ translateY: cardAnims[1].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: isDark ? colors.primary + '15' : colors.primary + '11', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.primary + '22' }}>
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

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {showRepairs && (
              <>
                <StatBox title="Received" value={repairs.filter(r => r.status === 'received').length} icon="inbox" color={colors.statusReceived} animValue={cardAnims[3]} />
                <StatBox title="In Repair" value={repairs.filter(r => ['diagnosing', 'waiting_parts', 'repairing', 'testing', 'cannot_repair', 'customer_approval'].includes(r.status)).length} icon="tool" color={colors.statusDiagnosing} animValue={cardAnims[4]} />
                <StatBox title="Ready for Delivery" value={repairs.filter(r => r.status === 'ready').length} icon="check-circle" color={colors.statusReady} animValue={cardAnims[5]} />
                <StatBox title="Delivered" value={repairs.filter(r => r.status === 'delivered').length} icon="package" color={colors.statusDelivered} animValue={cardAnims[6]} />
                <StatBox title="After-Sales Cases" value={stats.openReturns} icon="corner-up-left" color={colors.warning} animValue={cardAnims[7]} />
                {(user?.role === 'dealer' || user?.role === 'super_admin') && (
                  <StatBox title="Pending Refund Approvals" value={stats.pendingRefunds} icon="dollar-sign" color={colors.destructive} animValue={cardAnims[8]} />
                )}
              </>
            )}
            
            {showFinance && (
              <>
                <StatBox title="Today's Sales" value={stats.todayIncome} trend={stats.incomeTrend} icon="trending-up" color={colors.success} animValue={cardAnims[9]} isCurrency />
                <StatBox title="Today's Profit" value={stats.todayProfit} trend={stats.profitTrend} icon="dollar-sign" color={colors.primary} animValue={cardAnims[10]} isCurrency />
                <StatBox title="Pending Payments" value={stats.pendingPayments} icon="credit-card" color={colors.warning} animValue={cardAnims[11]} isCurrency />
              </>
            )}
            
            <StatBox title="Low Stock Items" value={stats.lowStock} icon="alert-triangle" color={stats.lowStock > 0 ? colors.destructive : colors.success} animValue={cardAnims[12]} />
            
            {canAccess('customers') && (
              <StatBox title="Total Customers" value={stats.totalCustomers} icon="users" color={colors.info} animValue={cardAnims[13]} />
            )}
            {canAccess('inventory') && (
              <StatBox title="Total Products" value={stats.totalProducts} icon="package" color={colors.primary} animValue={cardAnims[14]} />
            )}
          </View>"""

new_grid = """        <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 20 }}>
          {(user?.role === 'dealer' || user?.role === 'super_admin') && (dashboardStats?.openApprovalRequests || 0) > 0 && (
            <Animated.View style={{ opacity: cardAnims[0], transform: [{ translateY: cardAnims[0].interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more/approvals')}
                activeOpacity={0.8}
                style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.destructive + '15', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.destructive + '33' }}
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
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: isDark ? colors.primary + '15' : colors.primary + '11', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.primary + '22' }}>
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
          </View>"""

content = content.replace(target, new_grid)
with open('artifacts/mobile/app/(tabs)/index.tsx', 'w') as f:
    f.write(content)
