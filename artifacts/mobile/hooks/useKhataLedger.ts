import { useMemo } from 'react';
import { useKhataRepairs } from './useKhataRepairs';
import { usePaymentsList } from '@workspace/api-client-react';
import { buildKhataLedger, computeLedgerTotals, type KhataPartyType, type LedgerEntry, type KhataTotals } from '@/utils/khata-ledger';

export function useKhataLedger(partyType?: KhataPartyType, partyId?: string): {
  ledger: LedgerEntry[];
  totals: KhataTotals;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const { repairs, isLoading: repairsLoading, error: repairsError, reload: reloadRepairs } = useKhataRepairs(partyType, partyId);
  const { data: paymentsData, isLoading: paymentsLoading, error: paymentsError, refetch: reloadPayments } = usePaymentsList();

  const isLoading = repairsLoading || paymentsLoading;
  const error = repairsError || (paymentsError ? (paymentsError instanceof Error ? paymentsError.message : 'Failed to load payments') : null);

  const reload = async () => {
    await Promise.all([reloadRepairs(), reloadPayments()]);
  };

  const { ledger, totals } = useMemo(() => {
    let payments = paymentsData?.payments || [];
    // If we are filtering by party, we must filter the payments since the paymentsList API doesn't support party filtering.
    if (partyType && partyId) {
      if (partyType === 'customer') {
        // payments don't have customerId directly, but we can filter by matching repair
        const repairIds = new Set(repairs.map(r => r.id));
        payments = payments.filter(p => repairIds.has(p.repairId));
      } else if (partyType === 'dealer') {
        payments = payments.filter(p => p.dealerId === partyId);
      }
    }

    const compiledLedger = buildKhataLedger(repairs, payments);
    const computedTotals = computeLedgerTotals(compiledLedger);
    
    return {
      ledger: compiledLedger,
      totals: computedTotals,
    };
  }, [repairs, paymentsData?.payments, partyType, partyId]);

  return {
    ledger,
    totals,
    isLoading,
    error,
    reload,
  };
}