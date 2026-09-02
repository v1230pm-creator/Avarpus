import type { Repair } from '@/types';

export type KhataPartyType = 'customer' | 'dealer';

export interface KhataAmounts {
  billed: number;
  paid: number;
  due: number;
}

export interface KhataPartySummary extends KhataAmounts {
  id: string;
  name: string;
  repairCount: number;
  type: KhataPartyType;
}

const money = (value: number): number => Math.round(value * 100) / 100;

export function activeKhataRepairs(repairs: Repair[]): Repair[] {
  // A repair is posted to Khata only after handover. The delivery flow either
  // records the payment or explicitly confirms the outstanding amount as due.
  // Intake, in-progress, ready, cancelled and cannot-repair jobs stay out.
  return repairs.filter((repair) => repair.status === 'delivered');
}

export function getRepairKhataAmounts(repair: Repair): KhataAmounts {
  const rawSubtotal =
    repair.repairCharge +
    repair.partsCharge +
    (repair.serviceCharge ?? 0) +
    (repair.otherCharge ?? 0) -
    (repair.discount ?? 0);
  const subtotal = Math.max(0, rawSubtotal);
  const fallbackBilled = subtotal + (subtotal * (repair.taxPercent ?? 0)) / 100;
  const billed = money(Math.max(0, repair.totalAmount ?? fallbackBilled));
  const paid = money(Math.max(0, repair.paidAmount ?? repair.advance ?? 0));
  const due = money(Math.max(0, repair.balance ?? billed - paid));
  return { billed, paid, due };
}

export function summarizeKhataRepairs(repairs: Repair[]): KhataAmounts {
  return activeKhataRepairs(repairs).reduce<KhataAmounts>(
    (total, repair) => {
      const amounts = getRepairKhataAmounts(repair);
      return {
        billed: money(total.billed + amounts.billed),
        paid: money(total.paid + amounts.paid),
        due: money(total.due + amounts.due),
      };
    },
    { billed: 0, paid: 0, due: 0 },
  );
}

export function groupKhataParties(repairs: Repair[]): {
  customers: KhataPartySummary[];
  dealers: KhataPartySummary[];
} {
  const customers = new Map<string, KhataPartySummary>();
  const dealers = new Map<string, KhataPartySummary>();

  const add = (
    map: Map<string, KhataPartySummary>,
    type: KhataPartyType,
    id: string,
    name: string,
    amounts: KhataAmounts,
  ) => {
    const current = map.get(id) ?? {
      id,
      name,
      type,
      billed: 0,
      paid: 0,
      due: 0,
      repairCount: 0,
    };
    current.billed = money(current.billed + amounts.billed);
    current.paid = money(current.paid + amounts.paid);
    current.due = money(current.due + amounts.due);
    current.repairCount += 1;
    map.set(id, current);
  };

  for (const repair of activeKhataRepairs(repairs)) {
    const amounts = getRepairKhataAmounts(repair);
    if (repair.customerId) {
      add(customers, 'customer', repair.customerId, repair.customerName, amounts);
    }
    if (repair.dealerId) {
      add(
        dealers,
        'dealer',
        repair.dealerId,
        repair.dealerName?.trim() || 'Dealer',
        amounts,
      );
    }
  }

  const sort = (items: KhataPartySummary[]) =>
    items
      .filter((item) => item.billed > 0 || item.paid > 0)
      .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));

  return {
    customers: sort([...customers.values()]),
    dealers: sort([...dealers.values()]),
  };
}