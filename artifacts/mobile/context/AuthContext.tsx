import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, UserRole } from '@/types';
import { storage, KEYS } from '@/utils/storage';
import { seedIfNeeded } from '@/utils/seedData';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (emailOrMobile: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  canAccess: (feature: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: async () => ({ success: false }),
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await seedIfNeeded();
      const saved = await storage.get<User>(KEYS.CURRENT_USER);
      if (saved) setUser(saved);
      setIsLoading(false);
    })();
  }, []);

  const login = async (emailOrMobile: string, password: string) => {
    const users = await storage.get<User[]>(KEYS.USERS);
    if (!users) return { success: false, error: 'No users found' };
    const found = users.find(
      (u) =>
        (u.email.toLowerCase() === emailOrMobile.toLowerCase() ||
          u.mobile === emailOrMobile) &&
        u.password === password &&
        u.isActive,
    );
    if (!found) return { success: false, error: 'Invalid credentials' };
    await storage.set(KEYS.CURRENT_USER, found);
    setUser(found);
    return { success: true };
  };

  const logout = async () => {
    await storage.remove(KEYS.CURRENT_USER);
    setUser(null);
  };

  const canAccess = (feature: string): boolean => {
    if (!user) return false;
    const perms = ROLE_PERMISSIONS[user.role];
    return perms.includes('*') || perms.includes(feature);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout, canAccess }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
