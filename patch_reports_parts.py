with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'r') as f:
    content = f.read()

import_target = """import { staffList, useRefundsList, getUseRefundsListQueryKey } from '@workspace/api-client-react';"""
import_new = """import { staffList, useRefundsList, getRefundsListQueryKey, stockMovementsList } from '@workspace/api-client-react';"""
content = content.replace(import_target, import_new)

# Note: getUseRefundsListQueryKey was wrong, we fixed it to getRefundsListQueryKey
query_target = """  const { data: refundsData } = useRefundsList({
    query: {
      enabled: canSeeFinance,
      queryKey: getUseRefundsListQueryKey()
    }
  });"""
query_new = """  const { data: refundsData } = useRefundsList({
    query: {
      enabled: canSeeFinance,
      queryKey: getRefundsListQueryKey()
    }
  });"""
content = content.replace(query_target, query_new)

handle_target = """  const handleGenerate = async (report: ReportType) => {
    if (generatingId) return;

    if (report.id === 'staff' && !canSeeStaff) {
      notify('Not available', 'Only the shop owner can generate the staff report.');
      return;
    }"""
handle_new = """  const handleGenerate = async (report: ReportType) => {
    if (generatingId) return;

    if (report.id === 'staff' && !canSeeStaff) {
      notify('Not available', 'Only the shop owner can generate the staff report.');
      return;
    }

    setGeneratingId(report.id);
    
    let stockMovements: any[] = [];
    try {
      if (report.id === 'parts') {
        const res = await stockMovementsList();
        stockMovements = res.stockMovements || [];
      }
    } catch (e) {
      console.error('Failed to load parts consumption', e);
    }"""
content = content.replace(handle_target, handle_new)

data_target = """    const data: ReportData = {
      repairs,
      customers,
      inventory,
      purchases,
      finance,
      staff,
      refunds: refundsData?.refunds || [],
      shopName: user?.businessName ?? undefined,
    };
    const built = buildReportHtml(report.id, data);"""
data_new = """    const data: ReportData = {
      repairs,
      customers,
      inventory,
      purchases,
      finance,
      staff,
      refunds: refundsData?.refunds || [],
      stockMovements,
      shopName: user?.businessName ?? undefined,
    };
    const built = buildReportHtml(report.id, data);"""
content = content.replace(data_target, data_new)

generating_target = """    if (!built) return;

    if (built.rowCount === 0) {"""
generating_new = """    if (!built) {
      setGeneratingId(null);
      return;
    }

    if (built.rowCount === 0) {
      setGeneratingId(null);"""
content = content.replace(generating_target, generating_new)

# Make sure we don't return early without clearing generatingId on errors.
# Actually, the try/catch around Print.printToFileAsync already clears it.
# Let's check the bottom of handleGenerate.

with open('artifacts/mobile/app/(tabs)/more/reports.tsx', 'w') as f:
    f.write(content)
