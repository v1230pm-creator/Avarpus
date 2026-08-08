import sys

with open('artifacts/mobile/app/(tabs)/customers/[id].tsx', 'r') as f:
    content = f.read()

import_target = """import { useReturnsList, useRefundsList } from '@workspace/api-client-react';"""
import_new = """import { useReturnsList, useRefundsList, useCustomerSummary, getCustomerSummaryQueryKey } from '@workspace/api-client-react';"""

content = content.replace(import_target, import_new)

hooks_target = """  const { data: returnsData } = useReturnsList();
  const { data: refundsData } = useRefundsList();"""
hooks_new = """  const { data: returnsData } = useReturnsList();
  const { data: refundsData } = useRefundsList();
  const { data: summaryData } = useCustomerSummary(id as string, { query: { enabled: !!id, queryKey: getCustomerSummaryQueryKey(id as string) } });
  const summary = summaryData?.summary;"""

content = content.replace(hooks_target, hooks_new)

stats_target = """          <View style={styles.statsRow}>
            <View style={[styles.statBadge, { backgroundColor: colors.primary + '15' }]}>
              <Text style={[styles.statValue, { color: colors.primary, fontFamily: 'Inter_700Bold' }]}>{customer.totalRepairs}</Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Repairs</Text>
            </View>
            <View style={[styles.statBadge, { backgroundColor: customer.dueAmount > 0 ? colors.warning + '15' : colors.success + '15' }]}>
              <Text style={[styles.statValue, { color: customer.dueAmount > 0 ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }]}>
                {formatCurrency(customer.dueAmount)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>Due</Text>
            </View>
          </View>"""
stats_new = """          {summary && (
            <View style={{ width: '100%', marginTop: 16 }}>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{summary.totalRepairs}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Total Repairs</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontFamily: 'Inter_700Bold' }}>{summary.activeRepairs}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Active</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.success, fontFamily: 'Inter_700Bold' }}>{summary.deliveredRepairs}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Delivered</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: summary.outstandingBalance > 0 ? colors.warning : colors.success, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.outstandingBalance)}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Balance</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.paymentsTotal)}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Payments</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.info, fontFamily: 'Inter_700Bold' }}>{summary.activeWarranties || summary.warrantyActiveCount || 0}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Active Warranties</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.destructive, fontFamily: 'Inter_700Bold' }}>{summary.afterSalesCases}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Returns</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, color: colors.warning, fontFamily: 'Inter_700Bold' }}>{formatCurrency(summary.refundsTotal)}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: 'center' }}>Refunds</Text>
                </View>
              </View>
            </View>
          )}"""

content = content.replace(stats_target, stats_new)

with open('artifacts/mobile/app/(tabs)/customers/[id].tsx', 'w') as f:
    f.write(content)
