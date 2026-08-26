import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

const mockRecover = jest.fn();
const mockOtpVerify = jest.fn();
const mockAuthMe = jest.fn();
const mockLogout = jest.fn(async () => {});
const mockSeedIfNeeded = jest.fn(async () => {});
const mockCanRecover = jest.fn();
const mockGetDeviceId = jest.fn();
const mockStorageGet = jest.fn(async (_key: string): Promise<unknown> => null);
const mockStorageSet = jest.fn(async (_key: string, _value: unknown) => {});
const mockStorageRemove = jest.fn(async (_key: string) => {});

jest.mock('@workspace/api-client-react', () => ({
  authLogout: () => mockLogout(),
  authMe: (...args: unknown[]) => mockAuthMe(...args),
  authOtpVerify: (...args: unknown[]) => mockOtpVerify(...args),
  authTrustedDeviceRecover: (...args: unknown[]) => mockRecover(...args),
  roleFeaturesGet: jest.fn(async () => ({ features: {} })),
  setUnauthorizedHandler: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { deviceName: 'Pixel Test' },
}));

jest.mock('@/utils/seedData', () => ({
  seedIfNeeded: () => mockSeedIfNeeded(),
}));

jest.mock('@/utils/trustedDevice', () => ({
  canAttemptTrustedDeviceRecovery: () => mockCanRecover(),
  getTrustedAndroidDeviceId: () => mockGetDeviceId(),
}));

jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'auth_token', CURRENT_USER: 'current_user' },
  storage: {
    get: (key: string) => mockStorageGet(key),
    set: (key: string, value: unknown) => mockStorageSet(key, value),
    remove: (key: string) => mockStorageRemove(key),
  },
}));

import { Platform } from 'react-native';
import { AuthProvider, useAuth } from '@/context/AuthContext';

const session = {
  token: 'trusted-token',
  user: { id: 'user-1', name: 'Trusted User', role: 'dealer' },
};

function AuthProbe({ onChange }: { onChange: (auth: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth();
  onChange(auth);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('AuthProvider trusted-device flow', () => {
  const originalPlatform = Platform.OS;
  let auth: ReturnType<typeof useAuth>;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    mockCanRecover.mockReturnValue(true);
    mockGetDeviceId.mockResolvedValue('a1b2c3d4e5f60708');
    mockStorageGet.mockResolvedValue(null);
    mockRecover.mockResolvedValue(session);
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
  });

  function mount() {
    return render(
      <AuthProvider>
        <AuthProbe onChange={(value) => { auth = value; }} />
      </AuthProvider>,
    );
  }

  it('recovers and persists a native Android trusted-device session at startup', async () => {
    const view = mount();

    await waitFor(() => expect(auth.trustedDeviceStatus).toBe('verified'));
    expect(auth.user).toMatchObject({ id: 'user-1' });
    expect(mockRecover).toHaveBeenCalledWith({ androidDeviceId: 'a1b2c3d4e5f60708' });
    expect(mockStorageSet).toHaveBeenCalledWith('auth_token', 'trusted-token');
    expect(mockStorageSet).toHaveBeenCalledWith('current_user', expect.objectContaining({ id: 'user-1' }));
    view.unmount();
  });

  it('falls back to OTP when trusted-device recovery fails', async () => {
    mockRecover.mockRejectedValue(new Error('not trusted'));
    const view = mount();

    await waitFor(() => expect(auth.isLoading).toBe(false));
    expect(auth.user).toBeNull();
    expect(auth.trustedDeviceStatus).toBe('idle');
    view.unmount();
  });

  it('cancels pending recovery so a late response cannot adopt or persist its session', async () => {
    const pending = deferred<typeof session>();
    mockRecover.mockReturnValue(pending.promise);
    const view = mount();

    await waitFor(() => expect(auth.trustedDeviceStatus).toBe('checking'));
    act(() => auth.useOtpInstead());
    expect(auth.trustedDeviceStatus).toBe('skipped');

    await act(async () => { pending.resolve(session); });
    expect(auth.user).toBeNull();
    expect(mockStorageSet).not.toHaveBeenCalled();
    view.unmount();
  });

  it('sends Android trust and device information with OTP verification when available', async () => {
    mockCanRecover.mockReturnValue(false);
    mockOtpVerify.mockResolvedValue(session);
    const view = mount();

    await waitFor(() => expect(auth.isLoading).toBe(false));
    await act(async () => {
      await auth.loginWithOtp('9876543210', '123456', true);
    });

    expect(mockOtpVerify).toHaveBeenCalledWith({
      mobile: '9876543210',
      code: '123456',
      rememberMe: true,
      deviceInfo: 'Android · Pixel Test',
      androidDeviceId: 'a1b2c3d4e5f60708',
    });
    view.unmount();
  });

  it('never starts trusted recovery when the platform is unsupported', async () => {
    mockCanRecover.mockReturnValue(false);
    const view = mount();

    await waitFor(() => expect(auth.isLoading).toBe(false));
    expect(auth.trustedDeviceStatus).toBe('idle');
    expect(mockGetDeviceId).not.toHaveBeenCalled();
    expect(mockRecover).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not restore a late saved-session response after explicit logout', async () => {
    const pending = deferred<{ user: typeof session.user }>();
    mockStorageGet.mockResolvedValue('existing-token');
    mockAuthMe.mockReturnValue(pending.promise);
    const view = mount();

    await waitFor(() => expect(auth.isLoading).toBe(true));
    await act(async () => {
      await auth.logout();
    });
    await act(async () => {
      pending.resolve({ user: session.user });
    });

    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.isLoading).toBe(false);
    view.unmount();
  });
});