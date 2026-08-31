import {
  canAccessTabsRoute,
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

  it('keeps personal account routes open without business permissions', () => {
    const denied = () => false;
    expect(canAccessTabsRoute(['(tabs)', 'more', 'profile'], { role: 'technician', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'settings'], { role: 'technician', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'settings-detail'], { role: 'technician', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'chats'], { role: 'technician', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'chat-backup'], { role: 'technician', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'finance'], { role: 'technician', canAccess: denied })).toBe(false);
    expect(canAccessTabsRoute(['(tabs)', 'shop'], { role: 'customer', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'status'], { role: 'customer', canAccess: denied })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'calls'], { role: 'customer', canAccess: denied })).toBe(true);
  });

  it('separates repair-only Khata from payments-only ledger children', () => {
    const repairOnly = (feature: string) => feature === 'repairs';
    expect(canAccessTabsRoute(['(tabs)', 'khata'], { role: 'technician', canAccess: repairOnly })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'khata', 'party'], { role: 'technician', canAccess: repairOnly })).toBe(false);
  });

  it('gates staff business deep links before their screens mount', () => {
    const customersOnly = (feature: string) => feature === 'customers';
    expect(canAccessTabsRoute(['(tabs)', 'repairs', 'dealer', 'dealer-1'], { role: 'technician', canAccess: customersOnly })).toBe(true);
    expect(canAccessTabsRoute(['(tabs)', 'inventory'], { role: 'technician', canAccess: customersOnly })).toBe(false);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'staff'], { role: 'technician', canAccess: customersOnly })).toBe(false);
    expect(canAccessTabsRoute(['(tabs)', 'more', 'permissions'], { role: 'technician', canAccess: customersOnly })).toBe(false);
  });
});