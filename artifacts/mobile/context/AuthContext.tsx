import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { authLogin, authLogout, authMe, authOtpVerify, roleFeaturesGet, setUnauthorizedHandler } from '@workspace/api-client-react';
import { User, UserRole, isCustomerRole } from '@/types';
import { storage, KEYS } from '@/utils/storage';
import { seedIfNeeded } from '@/utils/seedData';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (emailOrMobile: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  loginWithOtp: (mobile: string, code: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Adopt a session returned by an auth API call (e.g. registration). */
  adoptSession: (session: { token: string; user: any }) => Promise<void>;
  canAccess: (feature: string) => boolean;
  /** Re-fetch this user's per-role feature toggles from the server. */
  refreshFeatures: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Message explaining why the user was signed out (e.g. session revoked). */
  signedOutNotice: string | null;
  clearSignedOutNotice: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
  loginWithOtp: async () => ({ success: false }),
  logout: async () => {},
  adoptSession: async () => {},
  canAccess: () => false,
  refreshFeatures: async () => {},
  refreshUser: async () => {},
  signedOutNotice: null,
  clearSignedOutNotice: () => {},
});

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  dealer: ['repairs', 'inventory', 'customers', 'finance', 'payments', 'staff', 'reports', 'settings', 'purchases', 'attendance', 'backup', 'profit', 'income', 'expense'],
  reception: ['repairs', 'repairs_create', 'customers'],
  technician: ['repairs', 'repairs_update', 'customers'],
  store_manager: ['inventory', 'purchases'],
  accountant: ['finance', 'reports', 'income', 'expense', 'profit'],
  // Dealer-portal accounts: read-only view of their own repairs. The server
  // enforces this fail-closed; these entries only shape the visible UI.
  dealer_owner: ['repairs_portal'],
  dealer_staff: ['repairs_portal'],
  // Customer self-service: can see inbox (chat) and their own profile only.
  // Never granted staff/inventory/finance/repair mutations.
  customer: ['chat'],
};

// Maps client permission strings (used across screens via canAccess) to the
// server-side feature-toggle keys the shop owner can switch per role in
// More → Staff Permissions. Permissions without a mapping (e.g. staff,
// settings) stay owner-only and are never toggleable.
const PERM_TO_FEATURE: Record<string, string> = {
  repairs: 'repairs',
  repairs_assigned: 'repairs',
  repairs_create: 'repairs_create',
  repairs_update: 'repairs_update',
  customers: 'customers',
  inventory: 'inventory',
  purchases: 'purchases',
  finance: 'finance',
  income: 'finance',
  expense: 'finance',
  profit: 'finance',
  payments: 'payments',
  reports: 'reports',
  approvals: 'approvals',
  repairs_portal: 'portal_repairs',
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
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  // Effective per-role feature toggles from the server (null until loaded).
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);

  // Track whether a user is currently signed in without re-registering the
  // global 401 handler on every render.
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // Global 401 handler: any authenticated API call that comes back 401 means
  // the session was revoked or expired. Clear local auth state so the app
  // routes back to the sign-in screen, with a friendly notice.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!userRef.current) return; // not signed in — nothing to do
      userRef.current = null;
      setSignedOutNotice('You were signed out. Please sign in again.');
      setUser(null);
      // Fire-and-forget: local state is already cleared for the UI.
      storage.remove(KEYS.AUTH_TOKEN).catch(() => {});
      storage.remove(KEYS.CURRENT_USER).catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, []);

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

  // Re-fetch the signed-in user (e.g. after a profile edit).
  const refreshUser = async () => {
    try {
      const res = await authMe();
      setUser(toUser(res.user));
    } catch {
      // keep the cached user on transient failures
    }
  };

  const refreshFeatures = async () => {
    try {
      const res = await roleFeaturesGet();
      setFeatures(res.features ?? {});
    } catch {
      // Keep whatever we had; canAccess falls back to role defaults when null.
    }
  };

  // Load feature toggles whenever a user signs in, and refresh periodically so
  // owner changes reach staff devices without needing a re-login.
  useEffect(() => {
    if (!user) {
      setFeatures(null);
      return;
    }
    if (isCustomerRole(user.role)) {
      // Customer access is a fixed, fail-closed portal policy. Do not call the
      // staff role-feature endpoint, which customer sessions cannot access.
      setFeatures({});
      return;
    }
    refreshFeatures();
    const timer = setInterval(refreshFeatures, 60_000);
    return () => clearInterval(timer);
  }, [user?.id]);

  const applySession = async (session: { token: string; user: any }) => {
    await storage.set(KEYS.AUTH_TOKEN, session.token);
    // Strip any password field the server might have accidentally included
    // before persisting the user object to AsyncStorage.
    const { password: _omit, ...safeUser } = session.user ?? {};
    const u = toUser(safeUser);
    await storage.set(KEYS.CURRENT_USER, u);
    setUser(u);
  };

  const adoptSession = async (session: { token: string; user: any }) => {
    await applySession(session);
    setSignedOutNotice(null);
  };

  const login = async (emailOrMobile: string, password: string, rememberMe = false) => {
    try {
      const session = await authLogin({ emailOrMobile, password, rememberMe, device: deviceDescription() });
      await applySession(session);
      setSignedOutNotice(null);
      return { success: true };
    } catch (err) {
      return { success: false, error: apiErrorMessage(err, 'Unable to sign in. Please try again.') };
    }
  };

  const loginWithOtp = async (mobile: string, code: string, rememberMe = false) => {
    try {
      const session = await authOtpVerify({ mobile, code, rememberMe, device: deviceDescription() });
      await applySession(session);
      setSignedOutNotice(null);
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
    // Owner roles are never restricted by the per-role toggles.
    if (user.role === 'super_admin' || user.role === 'dealer') {
      const perms = ROLE_PERMISSIONS[user.role];
      return !!perms && (perms.includes('*') || perms.includes(feature));
    }
    // Customer role: fixed permissions only — never evaluated through staff feature toggles.
    if (isCustomerRole(user.role)) {
      const perms = ROLE_PERMISSIONS['customer'];
      return perms.includes(feature);
    }
    // Staff/portal roles: honor the shop's feature toggles when loaded.
    const key = PERM_TO_FEATURE[feature];
    if (key && features) return features[key] === true;
    const perms = ROLE_PERMISSIONS[user.role];
    if (!perms) return false;
    return perms.includes('*') || perms.includes(feature);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        loginWithOtp,
        logout,
        adoptSession,
        canAccess,
        refreshFeatures,
        refreshUser,
        signedOutNotice,
        clearSignedOutNotice: () => setSignedOutNotice(null),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
