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

  it('ignores malformed notification payloads', () => {
    expect(getNotificationRoute(null)).toBeNull();
    expect(getNotificationRoute({ roomId: 42 })).toBeNull();
  });
});