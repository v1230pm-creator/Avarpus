export function getNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;

  if (typeof payload.roomId === 'string' && payload.roomId) {
    return `/(tabs)/customers/chat/${payload.roomId}`;
  }
  // Transfer requests (new / declined / cancelled) open the request itself —
  // the receiver has no repair row to open until they accept.
  if (typeof payload.transferId === 'string' && payload.transferId && payload.dealerTransaction !== true) {
    return `/(tabs)/repairs/dealer-transactions/request/${payload.transferId}`;
  }
  if (typeof payload.repairId === 'string' && payload.repairId) {
    // Dealer-to-dealer alerts (sent / received / status / bill / payment)
    // open the shared transaction view, which both shops can read. The plain
    // repair screen only exists for the repairing shop.
    if (payload.dealerTransaction === true) {
      return `/(tabs)/repairs/dealer-transactions/${payload.repairId}`;
    }
    return `/(tabs)/repairs/${payload.repairId}`;
  }
  if (typeof payload.approvalId === 'string' && payload.approvalId) {
    return '/(tabs)/more/approvals';
  }
  return null;
}
