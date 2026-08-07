import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { authLogin, authLogout, authMe, authOtpVerify } from '@workspace/api-client-react';
import { User, UserRole } from '@/types';
import { storage, KEYS } from '@/utils/storage';
import { seedIfNeeded } from '@/utils/seedData';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (emailOrMobile: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithOtp: (mobile: string, code: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  canAccess: (feature: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  loginWithOtp: async () => ({ success: false }),
  logout: async () => {},
  canAccess: () => false,
});

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  dealer: ['dashboard', 'repairs', 'inventory', 'customers', 'finance', 'staff', 'reports', 'settings', 'purchases', 'attendance', 'backup', 'profit', 'income', 'expense'],
  reception: ['dashboard', 'repairs', 'customers'],
  technician: ['dashboard', 'repairs_assigned', 'repairs_update'],
  store_manager: ['dashboard', 'inventory', 'purchases'],
  accountant: ['dashboard', 'finance', 'reports', 'income', 'expense', 'profit'],
};

function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  if (err instanceof Error && err.message && !/fetch/i.test(err.message)) return err.message;
  return fallback;
}

// Human-readable description of this device, recorded server-side at sign-in
// so the user can recognize sessions in Settings → Active sessions.
function deviceDescription(): string {
  const os = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web';
  const model = Constants.deviceName?.trim();
  return model ? `${os} · ${model}` : os;
}

function toUser(u: any): User {
  return { ...u, role: u.role as UserRole } as User;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await seedIfNeeded();
      const token = await storage.get<string>(KEYS.AUTH_TOKEN);
      if (token) {
        try {
          const res = await authMe();
          setUser(toUser(res.user));
        } catch {
          // Session invalid or server unreachable — require sign-in
          await storage.remove(KEYS.AUTH_TOKEN);
        }
      }
      setIsLoading(false);
    })();
  }, []);

  const applySession = async (session: { token: string; user: any }) => {
    await storage.set(KEYS.AUTH_TOKEN, session.token);
    const u = toUser(session.user);
    await storage.set(KEYS.CURRENT_USER, u);
    setUser(u);
  };

  const login = async (emailOrMobile: string, password: string, rememberMe = false) => {
    try {
      const session = await authLogin({ emailOrMobile, password, rememberMe, device: deviceDescription() });
      await applySession(session);
      return { success: true };
    } catch (err) {
      return { success: false, error: apiErrorMessage(err, 'Unable to sign in. Please try again.') };
    }
  };

  const loginWithOtp = async (mobile: string, code: string, rememberMe = false) => {
    try {
      const session = await authOtpVerify({ mobile, code, rememberMe, device: deviceDescription() });
      await applySession(session);
      return { success: true };
    } catch (err) {
      return { success: false, error: apiErrorMessage(err, 'Verification failed. Please try again.') };
    }
  };

  const logout = async () => {
    try {
      await authLogout();
    } catch {
      // Session may already be invalid server-side; clear local state regardless
    }
    await storage.remove(KEYS.AUTH_TOKEN);
    await storage.remove(KEYS.CURRENT_USER);
    setUser(null);
  };

  const canAccess = (feature: string): boolean => {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role];
    if (!perms) return false;
    return perms.includes('*') || perms.includes(feature);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, loginWithOtp, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
