import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  authLogout,
  authMe,
  authOtpVerify,
  authTrustedDeviceRecover,
  roleFeaturesGet,
  setUnauthorizedHandler,
} from '@workspace/api-client-react';
import { User, UserRole, isCustomerRole, isDealerPortalRole } from '@/types';
import { storage, KEYS } from '@/utils/storage';
import { seedIfNeeded } from '@/utils/seedData';
import { forgetPushRegistration, syncPushRegistration } from '@/utils/pushNotifications';
import {
  canAttemptTrustedDeviceRecovery,
  getTrustedAndroidDeviceId,
} from '@/utils/trustedDevice';

export type TrustedDeviceStatus = 'idle' | 'checking' | 'verified' | 'skipped';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithOtp: (mobile: string, code: string, rememberMe?: boolean) => Promise<{ success: boolean; error?: string; needsDisplayName?: boolean }>;
  logout: () => Promise<void>;
  /** Adopt a session returned by an auth API call (e.g. registration). */
  adoptSession: (session: { token: string; user: any }) => Promise<void>;
  canAccess: (feature: string) => boolean;
  /** Re-fetch this user's per-role feature toggles from the server. */
  refreshFeatures: () => Promise<void>;
  refreshUser: () => Promise<void>;
  dealerPortalInactive: boolean;
  /** Message explaining why the user was signed out (e.g. session revoked). */
  signedOutNotice: string | null;
  clearSignedOutNotice: () => void;
  trustedDeviceStatus: TrustedDeviceStatus;
  useOtpInstead: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  loginWithOtp: async () => ({ success: false }),
  logout: async () => {},
  adoptSession: async () => {},
  canAccess: () => false,
  refreshFeatures: async () => {},
  refreshUser: async () => {},
  dealerPortalInactive: false,
  signedOutNotice: null,
  clearSignedOutNotice: () => {},
  trustedDeviceStatus: 'idle',
  useOtpInstead: () => {},
});

const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  super_admin: ['*'],
  // A verified shop owner (role `dealer`) has full access to their own shop —
  // including every repair mutation (`repairs_create`, `repairs_update`,
  // approvals). The server scopes everything by shop id, so the client must
  // not hold back capabilities the owner already has.
  dealer: ['*'],
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

// These describe an individual's account, rather than a shop capability. They
// deliberately do not wait for the role-feature request.
const PERSONAL_PERMISSIONS = new Set(['chat', 'profile', 'personal_settings', 'notifications', 'logout']);
const CANONICAL_TO_FEATURE: Record<string, string> = {
  VIEW_KHATA: 'payments',
  EDIT_KHATA: 'payments',
  VIEW_REPAIR: 'repairs',
  EDIT_REPAIR: 'repairs_update',
  VIEW_BUSINESS_REPORTS: 'reports',
};

function apiErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  if (err instanceof Error && err.message && !/fetch/i.test(err.message)) return err.message;
  return fallback;
}

function apiErrorCode(err: unknown): string | undefined {
  return (err as { data?: { code?: string } })?.data?.code;
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

export function AuthProvider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient?: QueryClient;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const [trustedDeviceStatus, setTrustedDeviceStatus] = useState<TrustedDeviceStatus>('idle');
  const recoveryAttemptRef = useRef(0);
  const featureRequestRef = useRef(0);
  // Effective per-role feature toggles from the server (null until loaded).
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [dealerPortalInactive, setDealerPortalInactive] = useState(false);
  const resetIdentityCache = () => {
    void queryClient?.cancelQueries();
    queryClient?.clear();
  };

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
      recoveryAttemptRef.current += 1;
      featureRequestRef.current += 1;
      resetIdentityCache();
      userRef.current = null;
      setSignedOutNotice('You were signed out. Please sign in again.');
      setUser(null);
      setFeatures(null);
      setDealerPortalInactive(false);
      setIsLoading(false);
      // Fire-and-forget: local state is already cleared for the UI. The server
      // dropped the push token when it revoked the session; this clears the
      // device's copy so the next sign-in registers afresh.
      storage.remove(KEYS.AUTH_TOKEN).catch(() => {});
      storage.remove(KEYS.CURRENT_USER).catch(() => {});
      forgetPushRegistration().catch(() => {});
      setTrustedDeviceStatus('idle');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    const attempt = ++recoveryAttemptRef.current;
    (async () => {
      await seedIfNeeded();
      const token = await storage.get<string>(KEYS.AUTH_TOKEN);
      const cachedUser = await storage.get<User>(KEYS.CURRENT_USER);
      let restoredSession = false;
      if (token) {
        try {
          const res = await authMe();
          if (attempt !== recoveryAttemptRef.current) return;
          setUser(toUser(res.user));
          restoredSession = true;
          // Push tokens rotate and OS permission can change between launches,
          // so a restored session re-registers rather than trusting the last one.
          void syncPushRegistration(deviceDescription());
        } catch (error) {
          const status = (error as { status?: number })?.status;
          if (status === 401) {
            await storage.remove(KEYS.AUTH_TOKEN);
            await storage.remove(KEYS.CURRENT_USER);
          } else if (cachedUser) {
            // A temporary network/server failure must not sign the user out.
            // Keep the persisted identity and let authenticated queries retry.
            if (attempt !== recoveryAttemptRef.current) return;
            setUser(cachedUser);
            restoredSession = true;
          }
        }
      }
      if (!restoredSession && canAttemptTrustedDeviceRecovery()) {
        setTrustedDeviceStatus('checking');
        const androidDeviceId = await getTrustedAndroidDeviceId();
        if (attempt !== recoveryAttemptRef.current) return;
        if (androidDeviceId) {
          try {
            const session = await authTrustedDeviceRecover({ androidDeviceId });
            if (attempt !== recoveryAttemptRef.current) return;
            const applied = await applySession(
              session,
              () => attempt === recoveryAttemptRef.current,
            );
            if (!applied || attempt !== recoveryAttemptRef.current) return;
            setSignedOutNotice(null);
            setTrustedDeviceStatus('verified');
          } catch {
            if (attempt !== recoveryAttemptRef.current) return;
            setTrustedDeviceStatus('idle');
          }
        } else {
          setTrustedDeviceStatus('idle');
        }
      }
      if (attempt !== recoveryAttemptRef.current) return;
      setIsLoading(false);
    })();
  }, []);

  // Re-fetch the signed-in user (e.g. after a profile edit).
  const refreshUser = async () => {
    try {
      const res = await authMe();
      const updated = toUser(res.user);
      await storage.set(KEYS.CURRENT_USER, updated);
      setUser(updated);
    } catch {
      // keep the cached user on transient failures
    }
  };

  const refreshFeatures = async () => {
    const requestId = ++featureRequestRef.current;
    const userId = userRef.current?.id;
    if (!userId) {
      setFeatures(null);
      setDealerPortalInactive(false);
      return;
    }
    try {
      const res = await roleFeaturesGet();
      if (requestId !== featureRequestRef.current || userRef.current?.id !== userId) return;
      setFeatures(res.features ?? {});
      setDealerPortalInactive(false);
    } catch (error) {
      if (requestId !== featureRequestRef.current || userRef.current?.id !== userId) return;
      setDealerPortalInactive(
        isDealerPortalRole(userRef.current?.role) && apiErrorCode(error) === 'DEALER_INACTIVE',
      );
      // Do not retain a possibly stale grant after a refresh failure. Business
      // access must fail closed until the server supplies a current policy.
      setFeatures(null);
    }
  };

  // Load feature toggles whenever a user signs in, and refresh periodically so
  // owner changes reach staff devices without needing a re-login.
  useEffect(() => {
    featureRequestRef.current += 1;
    if (!user) {
      setFeatures(null);
      setDealerPortalInactive(false);
      return;
    }
    if (isCustomerRole(user.role)) {
      // Customer access is a fixed, fail-closed portal policy. Do not call the
      // staff role-feature endpoint, which customer sessions cannot access.
      setFeatures({});
      setDealerPortalInactive(false);
      return;
    }
    refreshFeatures();
    const timer = setInterval(refreshFeatures, 60_000);
    return () => clearInterval(timer);
  }, [user?.id, user?.role, user?.shopId]);

  const applySession = async (
    session: { token: string; user: any },
    shouldApply: () => boolean = () => true,
  ): Promise<boolean> => {
    if (!shouldApply()) return false;
    resetIdentityCache();
    featureRequestRef.current += 1;
    await storage.set(KEYS.AUTH_TOKEN, session.token);
    if (!shouldApply()) {
      if ((await storage.get<string>(KEYS.AUTH_TOKEN)) === session.token) {
        await storage.remove(KEYS.AUTH_TOKEN);
      }
      return false;
    }
    // Strip any password field the server might have accidentally included
    // before persisting the user object to AsyncStorage.
    const { password: _omit, ...safeUser } = session.user ?? {};
    const u = toUser(safeUser);
    await storage.set(KEYS.CURRENT_USER, u);
    if (!shouldApply()) {
      if ((await storage.get<string>(KEYS.AUTH_TOKEN)) === session.token) {
        await storage.remove(KEYS.AUTH_TOKEN);
        await storage.remove(KEYS.CURRENT_USER);
      }
      return false;
    }
    setFeatures(null);
    setDealerPortalInactive(false);
    setUser(u);
    // Bind this device to the new session so alerts arrive with the app
    // closed. Fire-and-forget: sign-in must not wait on a permission prompt
    // or the push service.
    void syncPushRegistration(deviceDescription());
    return true;
  };

  const adoptSession = async (session: { token: string; user: any }) => {
    await applySession(session);
    setSignedOutNotice(null);
  };

  const loginWithOtp = async (mobile: string, code: string, rememberMe = false) => {
    try {
      const androidDeviceId = await getTrustedAndroidDeviceId();
      const session = await authOtpVerify({
        mobile,
        code,
        rememberMe,
        deviceInfo: deviceDescription(),
        ...(androidDeviceId ? { androidDeviceId } : {}),
      });
      await applySession(session);
      setSignedOutNotice(null);
      setTrustedDeviceStatus('idle');
       return { success: true, needsDisplayName: session.needsDisplayName === true };
    } catch (err) {
      return { success: false, error: apiErrorMessage(err, 'Verification failed. Please try again.') };
    }
  };

  const logout = async () => {
    recoveryAttemptRef.current += 1;
    featureRequestRef.current += 1;
    const logoutRequest = authLogout().catch(() => {
      // Session may already be invalid server-side; local state is still cleared.
    });
    resetIdentityCache();
    userRef.current = null;
    setUser(null);
    setFeatures(null);
    setDealerPortalInactive(false);
    setTrustedDeviceStatus('idle');
    setIsLoading(false);
    await storage.remove(KEYS.AUTH_TOKEN);
    await storage.remove(KEYS.CURRENT_USER);
    // Signing out deletes the session server-side, which drops the device's
    // push token with it. Only the local record needs clearing here.
    await forgetPushRegistration();
    await logoutRequest;
  };

  const useOtpInstead = () => {
    recoveryAttemptRef.current += 1;
    setTrustedDeviceStatus('skipped');
    setIsLoading(false);
  };

  const canAccess = (feature: string): boolean => {
    if (!user) return false;
    if (PERSONAL_PERMISSIONS.has(feature)) return true;
    // Owner roles are never restricted by the per-role toggles.
    if (user.role === 'super_admin' || user.role === 'dealer') {
      const perms = ROLE_PERMISSIONS[user.role];
      return !!perms && (perms.includes('*') || perms.includes(feature));
    }
    // Customer role: fixed permissions only — never evaluated through staff feature toggles.
    if (isCustomerRole(user.role)) {
      const perms = ROLE_PERMISSIONS['customer'];
      // shopId is supplied only for a customer linked to a shop. Never infer
      // repair access from a name, mobile number, or locally cached record.
      return perms.includes(feature) || (feature === 'repairs_portal' && !!user.shopId);
    }
    // Dealer-portal accounts have an explicit, fixed portal policy. They are
    // not staff feature-toggle users.
    if (isDealerPortalRole(user.role)) {
      if (feature === 'repairs_portal' || feature === 'VIEW_REPAIR') {
        return features?.portal_repairs === true;
      }
      return false;
    }
    // Staff business capabilities are entirely server-controlled. In
    // particular, a loading or failed feature request must never fall back to
    // a locally cached role default.
    const key = PERM_TO_FEATURE[feature] ?? CANONICAL_TO_FEATURE[feature];
    if (key) return features?.[key] === true;
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
        loginWithOtp,
        logout,
        adoptSession,
        canAccess,
        refreshFeatures,
        refreshUser,
        dealerPortalInactive,
        signedOutNotice,
        clearSignedOutNotice: () => setSignedOutNotice(null),
        trustedDeviceStatus,
        useOtpInstead,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
