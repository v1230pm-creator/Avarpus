import type {
  DealerLedgerEntry,
  DealerLedgerEntryDirection,
  DealerLedgerEntryKind,
  DealerLedgerParty,
  RepairEvent,
} from '@workspace/api-client-react';
import { REPAIR_STATUS_LABELS } from '@/utils/helpers';

// Plain-language wording for the dealer-to-dealer ledger. Every amount the
// user sees is paired with one of these labels — colour alone never carries
// the meaning of a direction.

export const DEALER_DIRECTION_LABELS: Record<DealerLedgerEntryDirection, string> = {
  you_owe: 'You Owe',
  they_owe_you: 'They Owe You',
  you_paid: 'You Paid',
  you_received: 'You Received',
  refund_to_you: 'Refund To You',
  refund_by_you: 'Refund By You',
  voided: 'Voided',
};

export const DEALER_ENTRY_KIND_LABELS: Record<DealerLedgerEntryKind, string> = {
  bill: 'Repair Bill',
  payment: 'Payment',
  void: 'Payment Voided',
  refund: 'Refund',
};

/** Feather icon per entry kind. */
export const DEALER_ENTRY_KIND_ICONS: Record<DealerLedgerEntryKind, 'file-text' | 'credit-card' | 'slash' | 'rotate-ccw'> = {
  bill: 'file-text',
  payment: 'credit-card',
  void: 'slash',
  refund: 'rotate-ccw',
};

/** What the OTHER shop is to me, in this ledger's direction. */
export function dealerPartyRoleLabel(party: Pick<DealerLedgerParty, 'direction'>): string {
  return party.direction === 'payable' ? 'Supplier · repairs your devices' : 'Dealer · you repair their devices';
}

/** Wording for a party-level balance from the caller's side. */
export function dealerBalanceLabel(direction: DealerLedgerParty['direction'], balance: number): string {
  if (balance === 0) return 'Settled';
  if (direction === 'payable') return balance > 0 ? 'You Owe' : 'They Owe You';
  return balance > 0 ? 'They Owe You' : 'You Owe';
}

/**
 * Whether an entry moves money toward me or away from me, for the sign of
 * the amount shown next to its label. Voids are zero-value audit rows.
 */
export function dealerEntryEffect(entry: Pick<DealerLedgerEntry, 'direction'>): 'in' | 'out' | 'neutral' {
  switch (entry.direction) {
    case 'they_owe_you':
    case 'you_received':
    case 'refund_to_you':
      return 'in';
    case 'you_owe':
    case 'you_paid':
    case 'refund_by_you':
      return 'out';
    default:
      return 'neutral';
  }
}

/** Human title for a shared timeline event. */
export function dealerEventTitle(event: Pick<RepairEvent, 'action' | 'details'>): string {
  const details = (event.details ?? {}) as Record<string, unknown>;
  switch (event.action) {
    case 'dealer_sent':
      return 'Sent for repair';
    case 'dealer_received':
      return 'Received by repairing shop';
    case 'created':
      return 'Repair created';
    case 'status_changed': {
      const to = typeof details.to === 'string' ? details.to : undefined;
      return to ? `Status: ${REPAIR_STATUS_LABELS[to] ?? to}` : 'Status changed';
    }
    case 'delivered':
      return 'Delivered';
    case 'payment_recorded':
      return 'Payment recorded';
    case 'payment_voided':
      return 'Payment voided';
    case 'testing_confirmed':
      return 'Testing confirmed';
    case 'ready_notified':
      return 'Ready notification sent';
    case 'estimate_approval_requested':
      return 'Estimate approval requested';
    case 'estimate_approved':
      return 'Estimate approved';
    case 'estimate_rejected':
      return 'Estimate rejected';
    case 'delivery_otp_verified':
      return 'Delivery OTP verified';
    default:
      return event.action.replace(/_/g, ' ');
  }
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
