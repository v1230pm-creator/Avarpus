import { useCallback, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { shopSwitch } from '@workspace/api-client-react';
import { useAuth } from '@/context/AuthContext';
import { isBusinessQuery } from '@/utils/businessQueries';

/** Query key for `shopMe()` — the active Shop plus every membership of this account. */
export const SHOP_ME_QUERY_KEY = ['/shop/me'] as const;

/**
 * Drops every cached business query so nothing from the previous workspace
 * can be shown — even briefly — inside the one being entered.
 */
export async function resetBusinessQueries(queryClient: QueryClient) {
  await queryClient.cancelQueries({ predicate: isBusinessQuery });
  queryClient.removeQueries({ predicate: isBusinessQuery });
}

/**
 * Makes another membership the active Shop: the server switches the session,
 * the business caches are cleared, then the user record and feature policy
 * are reloaded so every gate reflects the new workspace.
 */
export function useWorkspaceSwitch() {
  const queryClient = useQueryClient();
  const { refreshUser, refreshFeatures } = useAuth();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);

  const switchTo = useCallback(async (shopId: string) => {
    setSwitchingTo(shopId);
    try {
      await shopSwitch(shopId);
      await resetBusinessQueries(queryClient);
      await refreshUser();
      await refreshFeatures();
      await queryClient.invalidateQueries({ queryKey: SHOP_ME_QUERY_KEY });
    } finally {
      setSwitchingTo(null);
    }
  }, [queryClient, refreshUser, refreshFeatures]);

  return { switchingTo, switching: switchingTo !== null, switchTo };
}
