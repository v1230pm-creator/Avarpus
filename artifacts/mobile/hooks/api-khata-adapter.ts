import {
  getCustomersKhataGetQueryKey,
  useCustomersKhataGet,
  useCustomersKhataTransactionsCreate,
} from '@workspace/api-client-react';
import type { LedgerEntry, KhataTotals, KhataPartyType } from '@/utils/khata-ledger';

export function getCustomerKhataGetQueryKey(id: string) {
  return getCustomersKhataGetQueryKey(id);
}

interface KhataGetResponse {
  entries: LedgerEntry[];
  totals: KhataTotals;
}

export function useCustomerKhataGet(id: string, options?: any) {
  return useCustomersKhataGet(id, {
    query: {
      ...options,
      select: (data): KhataGetResponse => ({
        entries: data.ledger.map((entry): LedgerEntry => ({
          id: entry.id,
          date: entry.bookDate,
          partyId: data.customer.id,
          partyName: data.customer.name,
          partyType: 'customer',
          repairId: entry.repairId ?? '',
          repairDbId: '',
          type:
            entry.type === 'repair_bill'
              ? 'bill'
              : entry.type === 'repair_payment'
                ? 'payment'
                : entry.type === 'refund'
                  ? 'refund'
                  : entry.type === 'repair_payment_void'
                    ? 'void'
                    : entry.direction === 'given'
                      ? 'manual_given'
                      : 'manual_received',
          label:
            entry.type === 'repair_bill'
              ? 'Repair Bill'
              : entry.type === 'repair_payment'
                ? 'Payment Received'
                : entry.type === 'refund'
                  ? 'Refund'
                  : entry.type === 'repair_payment_void'
                    ? 'Payment Voided'
                    : entry.direction === 'given'
                      ? 'Payment Given'
                      : 'Payment Received',
          note: entry.note,
          method: entry.method,
          debit: entry.direction === 'given' ? entry.amount : 0,
          credit: entry.direction === 'received' ? entry.amount : 0,
          partyBalance: entry.runningBalance,
        })),
        totals: {
          billed: data.totals.totalGiven,
          paid: data.totals.totalReceived,
          due: data.totals.balance,
        },
      }),
    },
  });
}

export function useCustomerKhataTransactionCreate(options?: any) {
  const mutation = useCustomersKhataTransactionsCreate(options);
  return {
    ...mutation,
    mutateAsync: (input: {
      partyId: string;
      partyType: KhataPartyType;
      type: 'given' | 'received';
      amount: number;
      note: string;
      date: string;
      clientRequestId: string;
    }) => {
      if (input.partyType !== 'customer') {
        return Promise.reject(new Error('Supplier khata entries are read-only'));
      }
      return mutation.mutateAsync({
        id: input.partyId,
        data: {
          direction: input.type,
          amount: input.amount,
          note: input.note || undefined,
          method: 'Cash',
          bookDate: input.date.slice(0, 10),
          clientRequestId: input.clientRequestId,
        },
      });
    },
  };
}
