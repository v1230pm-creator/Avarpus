import { getNotificationRoute } from '@/utils/notificationNavigation';

describe('notification navigation', () => {
  it('opens the exact direct-chat room from a chat notification', () => {
    expect(getNotificationRoute({ roomId: 'room-123', messageId: 'message-1' }))
      .toBe('/(tabs)/customers/chat/room-123');
  });

  it('preserves repair and approval notification routes', () => {
    expect(getNotificationRoute({ repairId: 'repair-1' }))
      .toBe('/(tabs)/repairs/repair-1');
    expect(getNotificationRoute({ approvalId: 'approval-1' }))
      .toBe('/(tabs)/more/approvals');
  });

  it('routes dealer-to-dealer alerts to the shared transaction view', () => {
    expect(getNotificationRoute({ repairId: 'repair-1', dealerTransaction: true }))
      .toBe('/(tabs)/repairs/dealer-transactions/repair-1');
    // Only a literal true opts in — a truthy string must not reroute.
    expect(getNotificationRoute({ repairId: 'repair-1', dealerTransaction: 'yes' }))
      .toBe('/(tabs)/repairs/repair-1');
  });

  it('routes transfer requests to the request screen, not a repair', () => {
    // New / declined / cancelled requests: the receiver has no repair row yet.
    expect(getNotificationRoute({ transferId: 'req-1', dealerTransfer: true }))
      .toBe('/(tabs)/repairs/dealer-transactions/request/req-1');
    expect(getNotificationRoute({ transferId: 'req-1', repairId: 'repair-1' }))
      .toBe('/(tabs)/repairs/dealer-transactions/request/req-1');
    // Accepted: the shared transaction view exists, prefer it.
    expect(getNotificationRoute({ transferId: 'req-1', repairId: 'repair-2', dealerTransaction: true }))
      .toBe('/(tabs)/repairs/dealer-transactions/repair-2');
  });

  it('ignores malformed notification payloads', () => {
    expect(getNotificationRoute(null)).toBeNull();
    expect(getNotificationRoute({ roomId: 42 })).toBeNull();
  });
});