import { useCallback, useEffect, useRef, useState } from 'react';
import { repairsList } from '@workspace/api-client-react';
import type { Repair } from '@/types';
import { activeKhataRepairs, type KhataPartyType } from '@/utils/khata';

const PAGE_SIZE = 200;

export function useKhataRepairs(
  partyType?: KhataPartyType,
  partyId?: string,
): {
  repairs: Repair[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setIsLoading(true);
    setError(null);

    try {
      const collected: Repair[] = [];
      let page = 1;
      let total = 0;

      do {
        const response = await repairsList({
          page,
          limit: PAGE_SIZE,
          ...(partyType === 'dealer' && partyId ? { dealerId: partyId } : {}),
        });
        const pageRepairs = response.repairs as Repair[];
        collected.push(...pageRepairs);
        total = response.total ?? collected.length;
        page += 1;
        if (pageRepairs.length === 0) break;
      } while (collected.length < total);

      if (currentRequest !== requestId.current) return;
      const scopedRepairs =
        partyType === 'customer' && partyId
          ? collected.filter((repair) => repair.customerId === partyId)
          : partyType === 'dealer' && partyId
            ? collected.filter((repair) => repair.dealerId === partyId)
            : collected;
      setRepairs(activeKhataRepairs(scopedRepairs));
    } catch (reason) {
      if (currentRequest !== requestId.current) return;
      setError(reason instanceof Error ? reason.message : 'Could not load Khata records.');
    } finally {
      if (currentRequest === requestId.current) setIsLoading(false);
    }
  }, [partyId, partyType]);

  useEffect(() => {
    reload();
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  return { repairs, isLoading, error, reload };
}