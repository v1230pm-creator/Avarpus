import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes'
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function apiErrorMessage(error: unknown, fallback: string) {
  const candidate = error as {
    message?: unknown;
    data?: unknown;
  } | null;
  const data = candidate?.data;
  if (data && typeof data === 'object') {
    for (const key of ['error', 'message', 'detail']) {
      const value = (data as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }
  return typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message
    : fallback
}
