import {
  buildKhataLedger,
  computeLedgerTotals,
  foldDealerEntriesIntoCustomers,
  groupLedgerByParty,
} from '../../utils/khata-ledger';
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
  status: 'delivered',
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
  it('does not post received, in-progress, ready, cancelled, or cannot-repair jobs', () => {
    const repairs = [
      mockRepair({ id: 'received', status: 'received', totalAmount: 1000 }),
      mockRepair({ id: 'repairing', status: 'repairing', totalAmount: 1000 }),
      mockRepair({ id: 'ready', status: 'ready', totalAmount: 1000 }),
      mockRepair({ id: 'cancelled', status: 'cancelled', totalAmount: 1000 }),
      mockRepair({ id: 'cannot-repair', status: 'cannot_repair', totalAmount: 1000 }),
    ];
    const payments = repairs.map((repair, index) =>
      mockPayment({ id: `hidden-payment-${index}`, repairId: repair.id, amount: 500 }),
    );

    expect(buildKhataLedger(repairs, payments)).toEqual([]);
  });

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

  it('combines duplicate dealer records with the same normalized name', () => {
    const repairs = [
      mockRepair({
        id: 'r1',
        dealerId: 'dealer-1',
        dealerName: 'Chhotu  Sarnath',
        totalAmount: 300,
        createdAt: '2026-08-17T10:00:00.000Z',
      }),
      mockRepair({
        id: 'r2',
        repairId: 'TKT-2',
        dealerId: 'dealer-2',
        dealerName: ' chhotu sarnath ',
        totalAmount: 300,
        createdAt: '2026-08-22T10:00:00.000Z',
      }),
    ];

    const parties = groupLedgerByParty(buildKhataLedger(repairs, []));

    expect(parties).toHaveLength(1);
    expect(parties[0]).toMatchObject({
      partyIds: ['dealer-2', 'dealer-1'],
      partyName: 'chhotu sarnath',
      balance: 600,
      lastActivity: '2026-08-22T10:00:00.000Z',
    });
  });

  it('keeps different customers separate even when their names match', () => {
    const repairs = [
      mockRepair({ id: 'r1', customerId: 'customer-1', customerName: 'Same Name', totalAmount: 100 }),
      mockRepair({ id: 'r2', customerId: 'customer-2', customerName: 'Same Name', totalAmount: 200 }),
    ];

    expect(groupLedgerByParty(buildKhataLedger(repairs, []))).toHaveLength(2);
  });

  it('sums party balances from the entries it is given, so a subset of a ledger groups correctly', () => {
    const repairs = [
      mockRepair({ id: 'r1', dealerId: 'dealer-1', dealerName: 'Ritesh', totalAmount: 1000, createdAt: '2026-09-19T10:00:00.000Z' }),
      mockRepair({ id: 'r2', repairId: 'TKT-2', dealerId: 'dealer-1', dealerName: 'Ritesh', totalAmount: 350, createdAt: '2026-09-21T10:00:00.000Z' }),
    ];
    const payments = [mockPayment({ id: 'p1', repairId: 'r1', amount: 400, createdAt: '2026-09-19T11:00:00.000Z' })];
    const ledger = buildKhataLedger(repairs, payments);

    expect(groupLedgerByParty(ledger)[0].balance).toBe(950);
    // Only r1's entries: the running balance on the newest of them includes r2, the sum must not.
    const onlyFirstRepair = ledger.filter((entry) => entry.repairDbId === 'r1');
    expect(groupLedgerByParty(onlyFirstRepair)[0]).toMatchObject({ balance: 600, lastActivity: '2026-09-19T11:00:00.000Z' });
  });

  it('folds dealer entries linked to a known customer into that customer and keeps the rest', () => {
    const repairs = [
      // Ritesh is both a customer record and a dealer record; his repairs carry both links.
      mockRepair({ id: 'r1', customerId: 'cust-ritesh', customerName: 'Ritesh patel', dealerId: 'dealer-ritesh', dealerName: 'Ritesh patel', totalAmount: 1350, createdAt: '2026-09-19T10:00:00.000Z' }),
      mockRepair({ id: 'r2', repairId: 'TKT-2', customerId: 'cust-ritesh', customerName: 'Ritesh patel', dealerId: 'dealer-ritesh', dealerName: 'Ritesh patel', totalAmount: 200, createdAt: '2026-09-21T10:00:00.000Z' }),
      // A legacy dealer repair with no customer link stays a dealer-only entry.
      mockRepair({ id: 'r3', repairId: 'TKT-3', customerId: undefined, dealerId: 'dealer-ritesh', dealerName: 'Ritesh patel', totalAmount: 500, createdAt: '2026-09-01T10:00:00.000Z' }),
      // A dealer repair linked to a customer this device does not know stays separate too.
      mockRepair({ id: 'r4', repairId: 'TKT-4', customerId: 'cust-unknown', dealerId: 'dealer-other', dealerName: 'Other Dealer', totalAmount: 100, createdAt: '2026-09-02T10:00:00.000Z' }),
      // Plain customer entries are never touched.
      mockRepair({ id: 'r5', repairId: 'TKT-5', customerId: 'cust-mukesh', customerName: 'Mukesh', totalAmount: 1200, createdAt: '2026-09-12T10:00:00.000Z' }),
    ];
    const payments = [mockPayment({ id: 'p1', repairId: 'r2', amount: 200, createdAt: '2026-09-21T12:00:00.000Z' })];
    const ledger = buildKhataLedger(repairs, payments);

    const { folded, unlinked } = foldDealerEntriesIntoCustomers(ledger, new Set(['cust-ritesh', 'cust-mukesh']));

    expect([...folded.entries()]).toEqual([
      ['cust-ritesh', { lastActivity: '2026-09-21T12:00:00.000Z', dealerIds: ['dealer-ritesh'] }],
    ]);
    expect(unlinked.map((entry) => entry.repairDbId).sort()).toEqual(['r3', 'r4']);
    expect(groupLedgerByParty(unlinked)).toEqual([
      expect.objectContaining({ partyType: 'dealer', partyName: 'Other Dealer', balance: 100 }),
      expect.objectContaining({ partyType: 'dealer', partyName: 'Ritesh patel', balance: 500 }),
    ]);
  });
});