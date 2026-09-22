/**
 * What the user sees when a saved attachment goes missing from the phone:
 * the "save again from server" bubble state, and the chat-backup screen's
 * "on this phone" section that tells them what a lost phone would take.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ChatMessage } from '@workspace/api-client-react';
import { MemoryChatStore } from '@/utils/chatStore';
import type { MediaIndexRow } from '@/utils/chatStore';
import {
  LOST_MEDIA_ACTION,
  LOST_MEDIA_TITLE,
  MediaPlaceholder,
  placeholderStateFor,
} from '@/components/chat/MediaPlaceholder';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#F8FAFC',
    foreground: '#111827',
    card: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#2F80ED',
    primaryForeground: '#FFFFFF',
    mutedForeground: '#64748B',
    backgroundSecondary: '#F1F5F9',
    destructive: '#EF4444',
    success: '#16A34A',
    warning: '#B87912',
  }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`),
  };
});

jest.mock('@/components/ui/AvarpusSpinner', () => {
  const { Text } = require('react-native');
  return { AvarpusSpinner: () => <Text>spinner</Text> };
});

jest.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn() }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));

jest.mock('@workspace/api-client-react', () => ({
  customFetch: jest.fn(),
  driveBackupOauthStart: jest.fn(),
  getDriveBackupGetQueryKey: () => ['drive-backup'],
  useDriveBackupGet: () => ({ data: undefined, isLoading: false, isError: true, refetch: jest.fn() }),
  useDriveBackupAccountDisconnect: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDriveBackupSettingsUpdate: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/utils/driveBackupCrypto', () => ({
  bytesToBase64: jest.fn(),
  decryptDriveBackup: jest.fn(),
  encryptDriveBackup: jest.fn(),
}));

const ME = 'user-me';
const mockStore = new MemoryChatStore(ME);
const mockSession: { media: object | null } = { media: {} };

jest.mock('@/context/ChatStoreContext', () => ({
  useChatStore: () => ({
    store: mockStore,
    media: mockSession.media,
    mediaFiles: null,
    autoDownload: { images: 'always', audio: 'always', documents: 'always', videos: 'wifi' },
    setAutoDownload: jest.fn(),
    ready: true,
    networkClass: 'wifi',
  }),
}));

import ChatBackupScreen from '../app/(tabs)/more/chat-backup';

function message(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    roomId: 'room-a',
    shopId: null,
    senderId: 'peer',
    senderName: 'Alice',
    kind: 'image',
    body: 'attachment',
    objectPath: `/objects/uploads/${id}`,
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...extra,
  } as ChatMessage;
}

function row(id: string, sizeBytes: number): MediaIndexRow {
  return {
    messageId: id,
    roomId: 'room-a',
    localPath: `file:///docs/chat-media/${ME}/room-a/${id}.jpg`,
    sizeBytes,
    mimeType: 'image/jpeg',
    origin: 'received',
    storedAcked: true,
    createdAt: '2026-09-02T00:00:00.000Z',
  };
}

describe('lost media bubble', () => {
  test('placeholderStateFor maps a lost download status to the lost tile', () => {
    expect(placeholderStateFor({ kind: 'pending' }, { state: 'lost', manual: false })).toBe('lost');
    expect(placeholderStateFor({ kind: 'pending' }, { state: 'failed', manual: true })).toBe('failed');
    expect(placeholderStateFor({ kind: 'pending' }, { state: 'downloading', manual: false })).toBe('downloading');
    expect(placeholderStateFor({ kind: 'pending' }, undefined)).toBe('download');
    // Once the relay copy is gone the loss is final, whatever the download state says.
    expect(placeholderStateFor({ kind: 'unavailable', reason: 'purged' }, { state: 'lost', manual: false })).toBe(
      'unavailable',
    );
  });

  test('the lost tile offers "save again from server" and a tap requests the download', () => {
    const onPress = jest.fn();
    render(<MediaPlaceholder state="lost" noun="photo" detail="1 KB" onPress={onPress} testID="tile" />);
    expect(screen.getByText(LOST_MEDIA_ACTION)).toBeTruthy();
    expect(screen.getByText(LOST_MEDIA_TITLE)).toBeTruthy();
    expect(screen.getByText('icon:download-cloud')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tile'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('a tile whose relay copy is gone stays inert', () => {
    const onPress = jest.fn();
    render(<MediaPlaceholder state="unavailable" noun="photo" onPress={onPress} testID="tile" />);
    fireEvent.press(screen.getByTestId('tile'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByText(LOST_MEDIA_ACTION)).toBeNull();
  });
});

describe('chat backup: on this phone', () => {
  beforeEach(async () => {
    mockSession.media = {};
    await mockStore.wipe();
  });

  test('shows how much is saved here and how much exists nowhere else, and follows store changes', async () => {
    await mockStore.upsertMessages([message('live'), message('gone', { mediaState: 'purged', objectPath: undefined })]);
    await mockStore.putMedia(row('live', 2048));
    await mockStore.putMedia(row('gone', 1024));

    render(<ChatBackupScreen />);
    await waitFor(() => expect(screen.getByText('2 media files saved on this phone')).toBeTruthy());
    expect(screen.getByText('3.0 KB')).toBeTruthy();
    expect(screen.getByText('1 media file only on this phone (1.0 KB)')).toBeTruthy();
    expect(screen.getByText(/gone for good/)).toBeTruthy();
    expect(screen.getByText('icon:alert-triangle')).toBeTruthy();

    // The server drops the other copy too: the warning grows without leaving the screen.
    await act(async () => {
      await mockStore.upsertMessages([message('live', { mediaState: 'expired', objectPath: undefined })]);
    });
    await waitFor(() => expect(screen.getByText('2 media files only on this phone (3.0 KB)')).toBeTruthy());
  });

  test('reassures when every file still has a server copy', async () => {
    await mockStore.upsertMessages([message('live')]);
    await mockStore.putMedia(row('live', 512));
    render(<ChatBackupScreen />);
    await waitFor(() => expect(screen.getByText('1 media file saved on this phone')).toBeTruthy());
    expect(screen.getByText('Everything here still has a server copy')).toBeTruthy();
    expect(screen.queryByText(/only on this phone \(/)).toBeNull();
  });

  test('is hidden where media is not kept on the device (no download manager)', async () => {
    mockSession.media = null;
    await mockStore.upsertMessages([message('live')]);
    await mockStore.putMedia(row('live', 512));
    render(<ChatBackupScreen />);
    // Give the (absent) subscription a chance to fire before asserting.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('chat-backup-on-device')).toBeNull();
  });
});
