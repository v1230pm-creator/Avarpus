export function getNotificationRoute(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;

  if (typeof payload.roomId === 'string' && payload.roomId) {
    return `/(tabs)/customers/chat/${payload.roomId}`;
  }
  if (typeof payload.repairId === 'string' && payload.repairId) {
    return `/(tabs)/repairs/${payload.repairId}`;
  }
  if (typeof payload.approvalId === 'string' && payload.approvalId) {
    return '/(tabs)/more/approvals';
  }
  return null;
}