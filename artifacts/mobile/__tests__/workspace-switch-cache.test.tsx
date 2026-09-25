import { QueryClient } from '@tanstack/react-query';
import {
  getChatRoomsListQueryKey,
  getCustomersListQueryKey,
  getDealersListQueryKey,
  getNotificationsListQueryKey,
  getRepairsGetQueryKey,
  getStaffListQueryKey,
} from '@workspace/api-client-react';
import { resetBusinessQueries, SHOP_ME_QUERY_KEY } from '@/hooks/useWorkspaceSwitch';
import { isBusinessQuery } from '@/utils/businessQueries';

// Switching Shops must evict every cached business record, keyed exactly the
// way the generated hooks key them (request path first), while personal data
// and the membership list survive the switch.
describe('resetBusinessQueries', () => {
  it('evicts Shop-scoped generated queries and keeps personal ones', async () => {
    const queryClient = new QueryClient();
    const business = [
      getCustomersListQueryKey(),
      getRepairsGetQueryKey('repair-1'),
      getDealersListQueryKey({ search: 'x' } as never),
      getStaffListQueryKey(),
    ];
    const personal = [getChatRoomsListQueryKey(), getNotificationsListQueryKey(), SHOP_ME_QUERY_KEY];
    for (const key of [...business, ...personal]) queryClient.setQueryData(key as readonly unknown[], { from: 'shop-a' });

    await resetBusinessQueries(queryClient);

    for (const key of business) expect(queryClient.getQueryData(key as readonly unknown[])).toBeUndefined();
    for (const key of personal) expect(queryClient.getQueryData(key as readonly unknown[])).toEqual({ from: 'shop-a' });
  });

  it('matches only whole /api/<family> roots', () => {
    expect(isBusinessQuery({ queryKey: ['/api/repairs'] })).toBe(true);
    expect(isBusinessQuery({ queryKey: ['/api/repairs/abc/payments'] })).toBe(true);
    expect(isBusinessQuery({ queryKey: ['/api/repairs?status=received'] })).toBe(true);
    expect(isBusinessQuery({ queryKey: ['/api/repairsx'] })).toBe(false);
    expect(isBusinessQuery({ queryKey: ['/repairs'] })).toBe(false);
    expect(isBusinessQuery({ queryKey: ['/api/chat/rooms'] })).toBe(false);
    expect(isBusinessQuery({ queryKey: [{ scope: 'repairs' }] })).toBe(false);
  });
});
