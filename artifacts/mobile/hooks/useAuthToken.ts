import { useEffect, useState } from 'react';
import { storage, KEYS } from '@/utils/storage';

/**
 * The stored bearer token, for image requests that bypass the API client
 * (server entity paths served by /api/storage need the Authorization header).
 * Resolves once per mount; null until read, or when signed out.
 */
export function useAuthToken(): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    storage
      .get<string>(KEYS.AUTH_TOKEN)
      .then((value) => {
        if (!cancelled) setToken(value ?? null);
      })
      .catch(() => {
        if (!cancelled) setToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return token;
}
