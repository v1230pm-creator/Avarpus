/**
 * Quote / preview thumbnails must never fetch the relay in device-owned mode:
 * they show the device copy or nothing, so a quoted photo cannot bypass the
 * user's auto-download rules. Without a device store the relay is used.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { MemoryChatStore } from '@/utils/chatStore';
import { useMediaThumbnailSource } from '@/hooks/useChatMedia';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockContext: { store: MemoryChatStore | null; media: object | null } = { store: null, media: null };
jest.mock('@/context/ChatStoreContext', () => ({
  useChatStore: () => ({ store: mockContext.store, media: mockContext.media }),
}));

const message = { id: 'm-1', roomId: 'room-a' };

describe('useMediaThumbnailSource', () => {
  beforeEach(() => {
    mockContext.store = null;
    mockContext.media = null;
  });

  it('streams the relay only when there is no device store (web / store unavailable)', () => {
    const { result } = renderHook(() => useMediaThumbnailSource(message, 'tok'));
    expect(result.current).toEqual({
      uri: expect.stringContaining('/api/chat/rooms/room-a/messages/m-1/media'),
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('device-owned mode: renders nothing while resolving and nothing when the copy is missing', async () => {
    mockContext.store = new MemoryChatStore('user-me');
    mockContext.media = {};
    const { result } = renderHook(() => useMediaThumbnailSource(message, 'tok'));
    expect(result.current).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    // Never a relay URL: no fetch happens for a photo the user has not downloaded.
    expect(result.current).toBeNull();
  });

  it('device-owned mode: uses the local copy once indexed and follows index changes', async () => {
    const store = new MemoryChatStore('user-me');
    mockContext.store = store;
    mockContext.media = {};
    const { result } = renderHook(() => useMediaThumbnailSource(message, 'tok'));
    await act(async () => {
      await store.putMedia({
        messageId: 'm-1',
        roomId: 'room-a',
        localPath: 'file:///docs/chat-media/user-me/room-a/m-1.jpg',
        sizeBytes: 10,
        mimeType: 'image/jpeg',
        origin: 'received',
        storedAcked: true,
        createdAt: '2026-09-02T00:00:00.000Z',
      });
    });
    await waitFor(() => expect(result.current).toEqual({ uri: 'file:///docs/chat-media/user-me/room-a/m-1.jpg' }));
    await act(async () => {
      await store.removeMedia(['m-1']);
    });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('never resolves a relay URL for purged media even without a store', () => {
    const { result } = renderHook(() => useMediaThumbnailSource({ ...message, mediaState: 'purged' }, 'tok'));
    expect(result.current).toBeNull();
  });
});
