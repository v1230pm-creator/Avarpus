/**
 * Chat storage screen: per-room media sizes, clearing a room's media (files
 * and index rows go, messages stay) and the auto-download rule switches.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ChatRoom } from '@workspace/api-client-react';
import { MemoryChatStore } from '@/utils/chatStore';
import type { MediaFileOps } from '@/utils/chatMedia';
import { DEFAULT_AUTO_DOWNLOAD, type AutoDownloadSettings } from '@/utils/chatMedia';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
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
  }),
}));

jest.mock('@/components/ui/AvarpusSpinner', () => {
  const { Text } = require('react-native');
  return { AvarpusSpinner: () => <Text>spinner</Text> };
});

const mockConfirm = jest.fn();
jest.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));

const ME = 'user-me';
const mockStore = new MemoryChatStore(ME);
const deletedRooms: string[] = [];
const mockFiles: MediaFileOps = {
  download: jest.fn(),
  importFile: jest.fn(),
  size: jest.fn().mockResolvedValue(null),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  deleteRoom: jest.fn(async (roomId: string) => {
    deletedRooms.push(roomId);
  }),
  deleteAccount: jest.fn().mockResolvedValue(undefined),
};
const mockState: { autoDownload: AutoDownloadSettings } = { autoDownload: { ...DEFAULT_AUTO_DOWNLOAD } };
const mockSetAutoDownload = jest.fn(async (next: AutoDownloadSettings) => {
  mockState.autoDownload = next;
});

jest.mock('@/context/ChatStoreContext', () => ({
  useChatStore: () => ({
    store: mockStore,
    mediaFiles: mockFiles,
    autoDownload: mockState.autoDownload,
    setAutoDownload: mockSetAutoDownload,
    ready: true,
    media: null,
    networkClass: 'wifi',
  }),
}));

import ChatStorageScreen from '../app/(tabs)/more/chat-storage';

function room(id: string, name: string): ChatRoom {
  return {
    id,
    shopId: null,
    scope: 'global_direct',
    kind: 'direct',
    name,
    isArchived: false,
    isPinned: false,
    isMuted: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  } as ChatRoom;
}

beforeAll(async () => {
  await mockStore.upsertRooms([room('room-a', 'Alice'), room('room-b', 'Bob')]);
  await mockStore.upsertMessages([
    {
      id: 'm-1',
      roomId: 'room-a',
      shopId: null,
      senderId: 'peer',
      senderName: 'Alice',
      kind: 'image',
      body: 'photo.jpg',
      createdAt: '2026-09-01T00:00:01.000Z',
    } as any,
  ]);
  await mockStore.putMedia({
    messageId: 'm-1',
    roomId: 'room-a',
    localPath: 'file:///docs/chat-media/user-me/room-a/m-1.jpg',
    sizeBytes: 2 * 1024 * 1024,
    mimeType: 'image/jpeg',
    origin: 'received',
    storedAcked: true,
    createdAt: '2026-09-01T00:00:02.000Z',
  });
  await mockStore.putMedia({
    messageId: 'm-2',
    roomId: 'room-b',
    localPath: 'file:///docs/chat-media/user-me/room-b/m-2.pdf',
    sizeBytes: 512 * 1024,
    mimeType: 'application/pdf',
    origin: 'received',
    storedAcked: true,
    createdAt: '2026-09-01T00:00:03.000Z',
  });
});

describe('Chat storage screen', () => {
  it('lists per-room media usage with the total, largest first', async () => {
    render(<ChatStorageScreen />);
    await waitFor(() => expect(screen.getByTestId('chat-storage-total')).toHaveTextContent('2.5 MB'));
    expect(screen.getByText('2 files across 2 chats')).toBeTruthy();
    const alice = screen.getByTestId('chat-storage-room-room-a');
    const bob = screen.getByTestId('chat-storage-room-room-b');
    expect(alice).toHaveTextContent(/^Alice2\.0 MB · 1 file/);
    expect(bob).toHaveTextContent(/^Bob512\.0 KB · 1 file/);
  });

  it('clears a room after confirmation: files and index rows go, the message stays', async () => {
    render(<ChatStorageScreen />);
    await waitFor(() => expect(screen.getByTestId('chat-storage-clear-room-a')).toBeTruthy());
    fireEvent.press(screen.getByTestId('chat-storage-clear-room-a'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const options = mockConfirm.mock.calls[0][0];
    expect(options.title).toBe('Clear media from Alice?');
    expect(options.caption).toBeNull();
    await act(async () => {
      await options.actions[0].onPress();
    });
    expect(deletedRooms).toEqual(['room-a']);
    expect(await mockStore.getMedia('m-1')).toBeNull();
    expect(await mockStore.getMedia('m-2')).not.toBeNull();
    expect(await mockStore.listMessages('room-a', { limit: 10 })).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId('chat-storage-room-room-a')).toBeNull());
    expect(screen.getByTestId('chat-storage-total')).toHaveTextContent('512.0 KB');
  });

  it('changes an auto-download rule', async () => {
    const view = render(<ChatStorageScreen />);
    fireEvent.press(screen.getByTestId('auto-download-videos-never'));
    expect(mockSetAutoDownload).toHaveBeenCalledWith({ ...DEFAULT_AUTO_DOWNLOAD, videos: 'never' });
    // The provider persists and re-renders with the new settings.
    view.rerender(<ChatStorageScreen />);
    fireEvent.press(screen.getByTestId('auto-download-images-wifi'));
    expect(mockSetAutoDownload).toHaveBeenLastCalledWith({ ...DEFAULT_AUTO_DOWNLOAD, videos: 'never', images: 'wifi' });
  });
});
