import { buildKhataLedger, computeLedgerTotals } from '../../utils/khata-ledger';
import type { Repair } from '../../types';
import type { PaymentsList200PaymentsItem } from '@workspace/api-client-react';

const mockRepair = (overrides: Partial<Repair>): Repair => ({
  id: 'r1',
  repairId: 'TKT-1',
  customerId: 'c1',
  customerName: 'John Doe',
  mobile: '1234567890',
  deviceType: 'Phone',
  brand: 'Apple',
  model: 'iPhone 12',
  problem: 'Screen broken',
  status: 'received',
  priority: 'normal',
  repairCharge: 0,
  partsCharge: 0,
  advance: 0,
  receiveDate: new Date().toISOString(),
  expectedDate: new Date().toISOString(),
  createdAt: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const mockPayment = (overrides: Partial<PaymentsList200PaymentsItem>): PaymentsList200PaymentsItem => ({
  id: 'p1',
  repairId: 'r1',
  amount: 500,
  method: 'cash',
  kind: 'partial',
  createdAt: '2026-08-01T11:00:00.000Z',
  ...overrides,
});

describe('khata-ledger', () => {
  it('orders entries newest first', () => {
    const repairs = [
      mockRepair({ id: 'r1', repairId: 'TKT-1', totalAmount: 1000, createdAt: '2026-08-01T10:00:00.000Z' }),
      mockRepair({ id: 'r2', repairId: 'TKT-2', totalAmount: 2000, createdAt: '2026-08-02T10:00:00.000Z' }),
    ];
    const payments = [
      mockPayment({ id: 'p1', repairId: 'r1', amount: 500, createdAt: '2026-08-01T11:00:00.000Z' }),
      mockPayment({ id: 'p2', repairId: 'r2', amount: 2000, createdAt: '2026-08-02T11:00:00.000Z' }),
    ];

    const ledger = buildKhataLedger(repairs, payments);

    expect(ledger).toHaveLength(4);
    // Newest first
    expect(ledger[0].id).toBe('pay-p2'); // 2026-08-02T11:00:00
    expect(ledger[1].id).toBe('bill-r2'); // 2026-08-02T10:00:00
    expect(ledger[2].id).toBe('pay-p1'); // 2026-08-01T11:00:00
    expect(ledger[3].id).toBe('bill-r1'); // 2026-08-01T10:00:00
  });

  it('computes debit and credit direction correctly', () => {
    const repairs = [
      mockRepair({ id: 'r1', repairId: 'TKT-1', totalAmount: 1000 }),
    ];
    const payments = [
      mockPayment({ id: 'p1', repairId: 'r1', amount: 500, kind: 'partial' }), // payment
      mockPayment({ id: 'p2', repairId: 'r1', amount: 100, kind: 'refund' }), // refund
    ];

    const ledger = buildKhataLedger(repairs, payments);

    const bill = ledger.find(e => e.type === 'bill')!;
    expect(bill.debit).toBe(1000);
    expect(bill.credit).toBe(0);

    const payment = ledger.find(e => e.type === 'payment')!;
    expect(payment.debit).toBe(0);
    expect(payment.credit).toBe(500);

    const refund = ledger.find(e => e.type === 'refund')!;
    expect(refund.debit).toBe(100);
    expect(refund.credit).toBe(0);
  });

  it('computes running balance for a party correctly', () => {
    const repairs = [
      mockRepair({ id: 'r1', repairId: 'TKT-1', totalAmount: 1000, createdAt: '2026-08-01T10:00:00.000Z' }),
    ];
    const payments = [
      mockPayment({ id: 'p1', repairId: 'r1', amount: 500, createdAt: '2026-08-01T11:00:00.000Z' }),
      mockPayment({ id: 'p2', repairId: 'r1', amount: 200, createdAt: '2026-08-01T12:00:00.000Z' }),
    ];

    const ledger = buildKhataLedger(repairs, payments);
    // order should be p2, p1, bill
    expect(ledger[2].type).toBe('bill');
    expect(ledger[2].partyBalance).toBe(1000);

    expect(ledger[1].type).toBe('payment');
    expect(ledger[1].partyBalance).toBe(500); // 1000 - 500

    expect(ledger[0].type).toBe('payment');
    expect(ledger[0].partyBalance).toBe(300); // 500 - 200
  });

  it('handles voids by preserving direction and reversing', () => {
    const repairs = [
      mockRepair({ id: 'r1', repairId: 'TKT-1', totalAmount: 1000, createdAt: '2026-08-01T10:00:00.000Z' }),
    ];
    const payments = [
      mockPayment({ id: 'p1', repairId: 'r1', amount: 500, createdAt: '2026-08-01T11:00:00.000Z', voidedAt: '2026-08-01T12:00:00.000Z' }),
    ];

    const ledger = buildKhataLedger(repairs, payments);
    // order: void, payment, bill
    expect(ledger[0].type).toBe('void');
    expect(ledger[0].debit).toBe(500); // voids a payment, so it adds to debt
    expect(ledger[0].credit).toBe(0);
    expect(ledger[0].partyBalance).toBe(1000);

    expect(ledger[1].type).toBe('payment');
    expect(ledger[1].debit).toBe(0);
    expect(ledger[1].credit).toBe(500);
    expect(ledger[1].partyBalance).toBe(500);
  });

  it('falls back to advance if no payments exist for the repair', () => {
    const repairs = [
      mockRepair({ id: 'r1', repairId: 'TKT-1', totalAmount: 1000, advance: 300, createdAt: '2026-08-01T10:00:00.000Z' }),
    ];
    const payments: PaymentsList200PaymentsItem[] = []; // empty

    const ledger = buildKhataLedger(repairs, payments);
    // Since fallback has same date as bill, bill is processed first.
    expect(ledger[0].type).toBe('fallback_advance');
    expect(ledger[0].credit).toBe(300);
    expect(ledger[0].partyBalance).toBe(700);

    expect(ledger[1].type).toBe('bill');
    expect(ledger[1].partyBalance).toBe(1000);
  });

  it('computes ledger totals properly with payments, refunds, and voids', () => {
    const repairs = [
      mockRepair({ id: 'r1', customerId: 'c1', totalAmount: 1000, createdAt: '2026-08-01T10:00:00.000Z' }),
      mockRepair({ id: 'r2', customerId: 'c2', totalAmount: 2000, createdAt: '2026-08-01T10:00:00.000Z' }),
    ];
    const payments = [
      // c1 pays 500
      mockPayment({ id: 'p1', repairId: 'r1', amount: 500, createdAt: '2026-08-01T11:00:00.000Z' }),
      // c1 refund of 100
      mockPayment({ id: 'p2', repairId: 'r1', amount: 100, kind: 'refund', createdAt: '2026-08-01T12:00:00.000Z' }),
      // c2 pays 2000, but it is voided
      mockPayment({ id: 'p3', repairId: 'r2', amount: 2000, createdAt: '2026-08-01T11:00:00.000Z', voidedAt: '2026-08-01T12:00:00.000Z' }),
      // c1 refund of 50, but it is voided
      mockPayment({ id: 'p4', repairId: 'r1', amount: 50, kind: 'refund', createdAt: '2026-08-01T13:00:00.000Z', voidedAt: '2026-08-01T14:00:00.000Z' }),
    ];

    const ledger = buildKhataLedger(repairs, payments);
    const totals = computeLedgerTotals(ledger);

    // Total billed should just be the sum of bills (1000 + 2000)
    expect(totals.billed).toBe(3000);
    
    // Total paid should be:
    // p1 payment (+500)
    // p2 refund (-100)
    // p3 payment (+2000) then voided (-2000) -> 0
    // p4 refund (-50) then voided (+50) -> 0
    // Net paid: 400
    expect(totals.paid).toBe(400);
    
    // Total due: 3000 - 400 = 2600
    expect(totals.due).toBe(2600);
  });
});