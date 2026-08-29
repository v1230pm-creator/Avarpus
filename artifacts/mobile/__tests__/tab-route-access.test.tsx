import {
  canCustomerAccessTabsRoute,
  canPortalAccessTabsRoute,
} from '@/utils/tabRouteAccess';

describe('restricted account tab routes', () => {
  const notificationRoute = ['(tabs)', 'more', 'notifications'];
  const chatRoute = ['(tabs)', 'customers', 'chat', 'room-123'];

  it('lets a customer open a chat notification and reach its conversation', () => {
    expect(canCustomerAccessTabsRoute(notificationRoute)).toBe(true);
    expect(canCustomerAccessTabsRoute(chatRoute)).toBe(true);
  });

  it('lets dealer portal roles open a chat notification and reach its conversation', () => {
    expect(canPortalAccessTabsRoute(notificationRoute)).toBe(true);
    expect(canPortalAccessTabsRoute(chatRoute)).toBe(true);
  });

  it('keeps unrelated business routes closed to restricted accounts', () => {
    expect(canCustomerAccessTabsRoute(['(tabs)', 'inventory'])).toBe(false);
    expect(canPortalAccessTabsRoute(['(tabs)', 'inventory'])).toBe(false);
  });
});