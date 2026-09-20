import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';

const mockStorageGet = jest.fn();
let lastImageProps: any = null;

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({ backgroundSecondary: '#eee', foreground: '#000' }),
}));

jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'auth_token' },
  storage: { get: (...args: any[]) => mockStorageGet(...args) },
}));

jest.mock('expo-image', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: any) => {
      lastImageProps = props;
      return ReactLocal.createElement(View, { testID: 'avatar-image' });
    },
  };
});

import { Avatar } from '@/components/ui/Avatar';

const SERVER_PATH = '/objects/uploads/profiles/u/final/o';

describe('Avatar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastImageProps = null;
    mockStorageGet.mockResolvedValue('tok-123');
  });

  it('shows initials when no photo is set', () => {
    render(<Avatar name="Chhaya Maurya" url={null} />);
    expect(screen.getByText('CM')).toBeTruthy();
    expect(screen.queryByTestId('avatar-image')).toBeNull();
  });

  it('loads server entity paths through the authenticated storage route only after the token is read', async () => {
    render(<Avatar name="Vikash Maurya" url={SERVER_PATH} />);
    expect(screen.queryByTestId('avatar-image')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('avatar-image')).toBeTruthy());
    expect(lastImageProps.source.uri).toContain(`/api/storage${SERVER_PATH}`);
    expect(lastImageProps.source.headers.Authorization).toBe('Bearer tok-123');
    expect(screen.queryByText('VM')).toBeNull();
  });

  it('falls back to initials for legacy raw bucket paths that can never load', () => {
    render(<Avatar name="Rahul Singh" url="/replit-objstore-x/.private%2Fuploads%2Fprofiles%2Fu%2Ffinal%2Fo" />);
    expect(screen.getByText('RS')).toBeTruthy();
    expect(screen.queryByTestId('avatar-image')).toBeNull();
    expect(mockStorageGet).not.toHaveBeenCalled();
  });

  it('renders device contact photos and external URLs without any credentials', () => {
    render(<Avatar name="Rahul Kushwaha" url="content://com.android.contacts/display_photo/12" />);
    expect(screen.getByTestId('avatar-image')).toBeTruthy();
    expect(lastImageProps.source.uri).toBe('content://com.android.contacts/display_photo/12');
    expect(lastImageProps.source.headers).toBeUndefined();
    expect(mockStorageGet).not.toHaveBeenCalled();
  });

  it('never sends the bearer token to an external host after switching from a server path', async () => {
    const { rerender } = render(<Avatar name="Vikash Maurya" url={SERVER_PATH} />);
    await waitFor(() => expect(lastImageProps?.source.headers?.Authorization).toBe('Bearer tok-123'));

    rerender(<Avatar name="Vikash Maurya" url="https://example.com/p.png" />);
    expect(lastImageProps.source.uri).toBe('https://example.com/p.png');
    expect(lastImageProps.source.headers).toBeUndefined();
  });

  it('does not request a protected path while signed out', async () => {
    mockStorageGet.mockResolvedValue(null);
    render(<Avatar name="Sudhir Maurya" url={SERVER_PATH} />);
    await waitFor(() => expect(screen.getByText('SM')).toBeTruthy());
    expect(mockStorageGet).toHaveBeenCalled();
    expect(screen.queryByTestId('avatar-image')).toBeNull();
  });

  it('retries a failed load once, then settles on initials, and starts fresh for a new url', async () => {
    jest.useFakeTimers();
    try {
      const { rerender } = render(<Avatar name="Sudhir Maurya" url={`${SERVER_PATH}-gone`} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId('avatar-image')).toBeTruthy();

      act(() => {
        lastImageProps.onError();
      });
      // First failure: placeholder while a retry is scheduled.
      expect(screen.queryByTestId('avatar-image')).toBeNull();
      expect(screen.queryByText('SM')).toBeNull();

      act(() => {
        jest.advanceTimersByTime(4000);
      });
      expect(screen.getByTestId('avatar-image')).toBeTruthy();

      act(() => {
        lastImageProps.onError();
      });
      expect(screen.getByText('SM')).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(10000);
      });
      expect(screen.queryByTestId('avatar-image')).toBeNull();

      rerender(<Avatar name="Sudhir Maurya" url={`${SERVER_PATH}-new`} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByTestId('avatar-image')).toBeTruthy();
      expect(lastImageProps.source.uri).toContain('-new');
    } finally {
      jest.useRealTimers();
    }
  });
});
