import { storage } from './storage';

// Auto-lock/logout after this many minutes of inactivity. 0 = disabled.
const INACTIVITY_KEY = 'vmc_inactivity_timeout_min';

export const DEFAULT_INACTIVITY_MINUTES = 15;
export const INACTIVITY_OPTIONS = [0, 5, 15, 30, 60] as const;

export async function getInactivityTimeoutMinutes(): Promise<number> {
  const val = await storage.get<number>(INACTIVITY_KEY);
  if (typeof val === 'number' && INACTIVITY_OPTIONS.includes(val as any)) return val;
  return DEFAULT_INACTIVITY_MINUTES;
}

export async function setInactivityTimeoutMinutes(minutes: number): Promise<void> {
  await storage.set(INACTIVITY_KEY, minutes);
}

export function inactivityLabel(minutes: number): string {
  if (minutes === 0) return 'Off';
  if (minutes >= 60) return `${minutes / 60} hr`;
  return `${minutes} min`;
}
