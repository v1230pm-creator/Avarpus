with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'r') as f:
    content = f.read()

import_target = """import { staffList } from '@workspace/api-client-react';"""
import_new = """import { staffList, useRefundsList, getUseRefundsListQueryKey } from '@workspace/api-client-react';"""
content = content.replace(import_target, import_new)

auth_target = """  const { user } = useAuth();
  const { repairs, customers, inventory, finance, purchases, isLoading, loadError, loadAll } = useData();"""
auth_new = """  const { user, canAccess } = useAuth();
  const { repairs, customers, inventory, finance, purchases, isLoading, loadError, loadAll } = useData();
  const canSeeFinance = canAccess('finance');
  
  const { data: refundsData } = useRefundsList({
    query: {
      enabled: canSeeFinance,
      queryKey: getUseRefundsListQueryKey()
    }
  });"""
content = content.replace(auth_target, auth_new)

data_target = """    const data: ReportData = {
      repairs,
      customers,
      inventory,
      purchases,
      finance,
      staff,
      shopName: user?.businessName ?? undefined,
    };"""
data_new = """    const data: ReportData = {
      repairs,
      customers,
      inventory,
      purchases,
      finance,
      staff,
      refunds: refundsData?.refunds || [],
      shopName: user?.businessName ?? undefined,
    };"""
content = content.replace(data_target, data_new)

with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'w') as f:
    f.write(content)
