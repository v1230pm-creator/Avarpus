import React, { createContext, useContext, useEffect, useState, ReactNode, useMemo } from "react";
import { setBaseUrl, setAuthTokenGetter, setUnauthorizedHandler } from "@workspace/api-client-react";
import { useAuthMe, getAuthMeQueryKey, useRoleFeaturesGet } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

const AUTH_KEY = "avarpus_auth_token";
const API_BASE_URL = import.meta.env.VITE_API_URL?.trim() || null;
const apiConfigurationError =
  import.meta.env.PROD && !API_BASE_URL
    ? "This web build is missing VITE_API_URL. Rebuild it with the public Avarpus API origin."
    : null;

// Generated hooks can issue requests during their first render. Configure the
// client at module initialization so a restored browser session never makes an
// unauthenticated request to the static Hostinger origin.
setBaseUrl(API_BASE_URL);
setAuthTokenGetter(() => localStorage.getItem(AUTH_KEY));

interface User {
  id: string;
  name: string;
  email: string;
  mobile: string;
  role: string;
  shopId?: string;
  dealerId?: string;
  needsDisplayName: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setSession: (token: string) => void;
  logout: () => void;
  canAccess: (feature: string) => boolean;
  apiConfigurationError: string | null;
  dealerPortalInactive: boolean;
  retryDealerPortal: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['*'],
  dealer: ['dashboard', 'repairs', 'inventory', 'customers', 'finance', 'payments', 'staff', 'reports', 'settings', 'purchases', 'attendance', 'backup', 'profit', 'income', 'expense'],
  reception: ['repairs', 'repairs_create', 'customers'],
  technician: ['repairs', 'repairs_update', 'customers'],
  store_manager: ['inventory', 'purchases'],
  accountant: ['finance', 'reports', 'income', 'expense', 'profit'],
  dealer_owner: ['repairs_portal'],
  dealer_staff: ['repairs_portal'],
  customer: ['chat'],
};

const PERM_TO_FEATURE: Record<string, string> = {
  dashboard: 'dashboard',
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

const PERSONAL_PERMISSIONS = new Set(['settings', 'notifications', 'chat', 'logout']);
const CANONICAL_TO_FEATURE: Record<string, string> = {
  VIEW_KHATA: 'payments',
  EDIT_KHATA: 'payments',
  VIEW_REPAIR: 'repairs',
  EDIT_REPAIR: 'repairs_update',
  VIEW_BUSINESS_REPORTS: 'reports',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem(AUTH_KEY));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void queryClient.cancelQueries();
      queryClient.clear();
      setToken(null);
      localStorage.removeItem(AUTH_KEY);
      setLocation("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, setLocation]);

  const { data: authData, isLoading: isAuthLoading } = useAuthMe({
    query: {
      queryKey: getAuthMeQueryKey(),
      enabled: !!token && !apiConfigurationError,
      retry: false,
    }
  });

  const user = authData?.user || null;
  const isAuthenticated = !!user;
  const isCustomerRole = user?.role === 'customer';

  const {
    data: featuresData,
    isLoading: isFeaturesLoading,
    isError: isFeaturesError,
    error: featuresError,
    refetch: refetchFeatures,
  } = useRoleFeaturesGet({
    query: {
      queryKey: ["roleFeatures", user?.id],
      enabled: !!user && !isCustomerRole,
      staleTime: 60000,
      refetchInterval: 60000,
    }
  });

  const setSession = (newToken: string) => {
    void queryClient.cancelQueries();
    queryClient.clear();
    localStorage.setItem(AUTH_KEY, newToken);
    setToken(newToken);
  };

  const logout = () => {
    void queryClient.cancelQueries();
    queryClient.clear();
    localStorage.removeItem(AUTH_KEY);
    setToken(null);
    setLocation("/login");
  };

  // Undefined is materially different from an empty response: while the
  // request is loading or has failed, staff business access must fail closed.
  const features = isFeaturesError ? undefined : featuresData?.features;
  const dealerPortalInactive =
    (user?.role === 'dealer_owner' || user?.role === 'dealer_staff') &&
    (featuresError as { data?: { code?: string } } | null)?.data?.code === 'DEALER_INACTIVE';

  const canAccess = useMemo(() => {
    return (feature: string): boolean => {
      if (!user) return false;
      if (PERSONAL_PERMISSIONS.has(feature)) return true;
      if (user.role === 'super_admin' || user.role === 'dealer') {
        const perms = ROLE_PERMISSIONS[user.role];
        return !!perms && (perms.includes('*') || perms.includes(feature));
      }
      if (isCustomerRole) {
        const perms = ROLE_PERMISSIONS['customer'];
        return !!perms && perms.includes(feature);
      }
      if (user.role === 'dealer_owner' || user.role === 'dealer_staff') {
        if (feature === 'repairs_portal' || feature === 'VIEW_REPAIR') {
          return features?.portal_repairs === true;
        }
        return false;
      }
      const key = PERM_TO_FEATURE[feature] ?? CANONICAL_TO_FEATURE[feature];
      if (key) return features?.[key] === true;
      const perms = ROLE_PERMISSIONS[user.role];
      if (!perms) return false;
      return perms.includes('*') || perms.includes(feature);
    };
  }, [user, features, isCustomerRole]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoading: !!token && (isAuthLoading || (isAuthenticated && !isCustomerRole && isFeaturesLoading)), 
      setSession, 
      logout,
      canAccess,
      apiConfigurationError,
      dealerPortalInactive,
      retryDealerPortal: async () => {
        await refetchFeatures();
      },
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
