import type { Repair } from '@/types';
import type { PaymentsList200PaymentsItem } from '@workspace/api-client-react';

export type KhataPartyType = 'customer' | 'dealer';

export type LedgerEntryType = 'bill' | 'payment' | 'refund' | 'void' | 'fallback_advance';

export interface LedgerEntry {
  id: string;
  date: string;
  partyId: string;
  partyName: string;
  partyType: KhataPartyType;
  repairId: string; // Display ticket ID
  repairDbId: string; // Database ID
  type: LedgerEntryType;
  label: string;
  method?: string;
  debit: number; // Increases what they owe
  credit: number; // Decreases what they owe
  partyBalance: number; // Running balance for this party after this entry
}

export interface KhataTotals {
  billed: number;
  paid: number;
  due: number;
}

const money = (value: number): number => Math.round(value * 100) / 100;

function getBilledAmount(repair: Repair): number {
  if (repair.totalAmount !== undefined && repair.totalAmount !== null) {
    return money(Math.max(0, repair.totalAmount));
  }
  const rawSubtotal =
    repair.repairCharge +
    repair.partsCharge +
    (repair.serviceCharge ?? 0) +
    (repair.otherCharge ?? 0) -
    (repair.discount ?? 0);
  const subtotal = Math.max(0, rawSubtotal);
  return money(subtotal + (subtotal * (repair.taxPercent ?? 0)) / 100);
}

export function buildKhataLedger(repairs: Repair[], payments: PaymentsList200PaymentsItem[]): LedgerEntry[] {
  const entries: Omit<LedgerEntry, 'partyBalance'>[] = [];
  const paymentsByRepair = new Map<string, PaymentsList200PaymentsItem[]>();

  for (const p of payments) {
    const list = paymentsByRepair.get(p.repairId) || [];
    list.push(p);
    paymentsByRepair.set(p.repairId, list);
  }

  for (const repair of repairs) {
    if (repair.status === 'cancelled') continue;

    const isDealer = !!repair.dealerId;
    const partyId = isDealer ? repair.dealerId! : repair.customerId;
    const partyName = isDealer ? (repair.dealerName?.trim() || 'Dealer') : repair.customerName;
    const partyType: KhataPartyType = isDealer ? 'dealer' : 'customer';

    const billed = getBilledAmount(repair);
    if (billed > 0) {
      entries.push({
        id: `bill-${repair.id}`,
        date: repair.createdAt,
        partyId,
        partyName,
        partyType,
        repairId: repair.repairId,
        repairDbId: repair.id,
        type: 'bill',
        label: 'Repair Bill',
        debit: billed,
        credit: 0,
      });
    }

    const repairPayments = paymentsByRepair.get(repair.id) || [];

    if (repairPayments.length > 0) {
      for (const p of repairPayments) {
        const isRefund = p.kind === 'refund';
        
        entries.push({
          id: `pay-${p.id}`,
          date: p.createdAt,
          partyId,
          partyName,
          partyType,
          repairId: repair.repairId,
          repairDbId: repair.id,
          type: isRefund ? 'refund' : 'payment',
          label: isRefund ? 'Refund' : 'Payment',
          method: p.method,
          debit: isRefund ? p.amount : 0,
          credit: isRefund ? 0 : p.amount,
        });

        if (p.voidedAt) {
          entries.push({
            id: `void-${p.id}`,
            date: p.voidedAt,
            partyId,
            partyName,
            partyType,
            repairId: repair.repairId,
            repairDbId: repair.id,
            type: 'void',
            label: isRefund ? 'Refund Voided' : 'Payment Voided',
            method: p.method,
            debit: isRefund ? 0 : p.amount,
            credit: isRefund ? p.amount : 0,
          });
        }
      }
    } else {
      // Fallback
      const advance = money(Math.max(0, repair.advance ?? 0));
      if (advance > 0) {
        entries.push({
          id: `fallback-${repair.id}`,
          date: repair.createdAt, // fallback to repair created date
          partyId,
          partyName,
          partyType,
          repairId: repair.repairId,
          repairDbId: repair.id,
          type: 'fallback_advance',
          label: 'Advance (Legacy)',
          debit: 0,
          credit: advance,
        });
      }
    }
  }

  // Sort chronological ascending
  entries.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    // If same time, process bills before payments so balance goes positive before negative
    if (a.type === 'bill' && b.type !== 'bill') return -1;
    if (b.type === 'bill' && a.type !== 'bill') return 1;
    return 0;
  });

  const partyBalances = new Map<string, number>();
  const finalEntries: LedgerEntry[] = [];

  for (const entry of entries) {
    const prev = partyBalances.get(entry.partyId) || 0;
    const next = money(prev + entry.debit - entry.credit);
    partyBalances.set(entry.partyId, next);
    
    finalEntries.push({
      ...entry,
      partyBalance: next,
    });
  }

  // Return newest first
  return finalEntries.reverse();
}

export function computeLedgerTotals(ledger: LedgerEntry[]): KhataTotals {
  let billed = 0;
  let paid = 0;
  const partyBalances = new Map<string, number>();

  for (const entry of ledger) {
    if (entry.type === 'bill') {
      billed += entry.debit;
    } else if (entry.type === 'payment' || entry.type === 'fallback_advance') {
      paid += entry.credit;
    } else if (entry.type === 'refund') {
      paid -= entry.debit;
    } else if (entry.type === 'void') {
      if (entry.debit > 0) {
        // Voiding a payment creates a debit
        paid -= entry.debit;
      } else if (entry.credit > 0) {
        // Voiding a refund creates a credit
        paid += entry.credit;
      }
    }

    // Since ledger is newest first, the first time we see a partyId, that's their final balance.
    if (!partyBalances.has(entry.partyId)) {
      partyBalances.set(entry.partyId, entry.partyBalance);
    }
  }

  let due = 0;
  for (const balance of partyBalances.values()) {
    due += balance;
  }

  return {
    billed: money(billed),
    paid: money(paid),
    due: money(due),
  };
}
