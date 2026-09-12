/**
 * Forward screen: recipients list with circle checks, exact-number search,
 * device-contact picker, and one forward per target per message plus an
 * optional note.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Feather: ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`),
    MaterialCommunityIcons: ({ name }: { name: string }) => React.createElement(Text, null, `icon:${name}`),
  };
});

jest.mock('@/components/ui/Avatar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Avatar: ({ name }: { name: string }) => React.createElement(Text, null, `Avatar:${name}`) };
});

jest.mock('@/components/ui/AvarpusSpinner', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { AvarpusSpinner: () => React.createElement(Text, null, 'spinner') };
});

jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { Image: ({ testID, accessibilityLabel }: any) => React.createElement(View, { testID, accessibilityLabel }) };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#F8FAFC', foreground: '#111827', card: '#FFFFFF', border: '#E2E8F0', primary: '#2F80ED',
    primaryForeground: '#FFFFFF', mutedForeground: '#64748B', backgroundSecondary: '#F1F5F9',
    destructive: '#EF4444', success: '#22C55E',
  }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(JSON.stringify('test-bearer-token')),
  setItem: jest.fn(), removeItem: jest.fn(), clear: jest.fn(),
}));

const mockGetContactsPermissionsAsync = jest.fn();
const mockRequestContactsPermissionsAsync = jest.fn();
const mockGetContactsAsync = jest.fn();
jest.mock('expo-contacts/legacy', () => ({
  getPermissionsAsync: (...args: any[]) => mockGetContactsPermissionsAsync(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestContactsPermissionsAsync(...args),
  getContactsAsync: (...args: any[]) => mockGetContactsAsync(...args),
  Fields: { PhoneNumbers: 'phoneNumbers', Image: 'image' },
  SortTypes: { FirstName: 'firstName' },
}));

const mockUseChatMessagesList = jest.fn();
const mockUseChatRoomsList = jest.fn();
const mockUseChatMessagesSend = jest.fn();
const mockUseChatRoomsCreate = jest.fn();
const mockUseChatContactsMatch = jest.fn();
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);

jest.mock('@workspace/api-client-react', () => ({
  useChatMessagesList: (...args: any[]) => mockUseChatMessagesList(...args),
  useChatRoomsList: (...args: any[]) => mockUseChatRoomsList(...args),
  useChatMessagesSend: (...args: any[]) => mockUseChatMessagesSend(...args),
  useChatRoomsCreate: (...args: any[]) => mockUseChatRoomsCreate(...args),
  useChatContactsMatch: (...args: any[]) => mockUseChatContactsMatch(...args),
  getChatRoomsListQueryKey: () => ['/api/chat/rooms'],
  getChatRoomsGetQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}`],
  getChatMessagesListQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}/messages`],
  getChatMessageMediaUrl: (roomId: string, messageId: string) => `/api/chat/rooms/${roomId}/messages/${messageId}/media`,
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

import ForwardScreen from '../app/(tabs)/customers/chat/forward';

const photo = { id: 'msg-photo', body: 'IMG.jpg', senderId: 'other', senderName: 'Alice', roomId: 'room-1', shopId: 's1', kind: 'image', createdAt: '2026-01-01T10:00:00Z' };
const text = { id: 'msg-text', body: 'Hello there', senderId: 'me', senderName: 'Me', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: '2026-01-01T10:01:00Z' };
const rooms = [
  { id: 'room-1', name: 'Alice', kind: 'direct', scope: 'global_direct', shopId: null, isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T09:00:00Z', peerUserId: 'other' },
  { id: 'room-2', name: 'Bob Repairs', kind: 'customer', scope: 'shop', shopId: 's1', isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T09:00:00Z' },
  { id: 'room-3', name: 'Blocked Guy', kind: 'direct', scope: 'global_direct', shopId: null, isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T09:00:00Z', isBlocked: true },
];

let sendAsync: jest.Mock;
let createAsync: jest.Mock;
let matchAsync: jest.Mock;
let router: { push: jest.Mock; back: jest.Mock; replace: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  router = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
  (useRouter as jest.Mock).mockReturnValue(router);
  (useLocalSearchParams as jest.Mock).mockReturnValue({ roomId: 'room-1', messageIds: 'msg-photo,msg-text' });
  mockUseChatMessagesList.mockReturnValue({ data: { messages: [text, photo], hasMore: false } });
  mockUseChatRoomsList.mockReturnValue({ data: { rooms }, isLoading: false });
  sendAsync = jest.fn().mockResolvedValue({ message: { id: 'new' } });
  createAsync = jest.fn().mockResolvedValue({ room: { id: 'room-new', name: 'Charlie' } });
  matchAsync = jest.fn().mockResolvedValue({ contacts: [] });
  mockUseChatMessagesSend.mockReturnValue({ mutateAsync: sendAsync, isPending: false });
  mockUseChatRoomsCreate.mockReturnValue({ mutateAsync: createAsync, isPending: false });
  mockUseChatContactsMatch.mockReturnValue({ mutateAsync: matchAsync });
  mockGetContactsPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockGetContactsAsync.mockResolvedValue({ data: [] });
});

describe('Forward screen', () => {
  it('lists chats (minus blocked) in source order, previews the forwarded items, and sends in order', async () => {
    render(<ForwardScreen />);
    expect(screen.getByText('Forward to…')).toBeTruthy();
    expect(screen.getByTestId('forward-target-room:room-1')).toBeTruthy();
    expect(screen.getByTestId('forward-target-room:room-2')).toBeTruthy();
    expect(screen.queryByTestId('forward-target-room:room-3')).toBeNull();
    // Previews follow the selection order passed in the route.
    expect(screen.getByTestId('forward-preview-msg-photo')).toBeTruthy();
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.queryByTestId('forward-selected-row')).toBeNull();

    fireEvent.press(screen.getByTestId('forward-target-room:room-2'));
    expect(screen.getByTestId('forward-target-room:room-2').props.accessibilityState).toEqual({ checked: true });
    expect(within(screen.getByTestId('forward-selected-row')).getByText('Bob Repairs')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('forward-note-input'), 'FYI');
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });

    await waitFor(() => expect(sendAsync).toHaveBeenCalledTimes(3));
    expect(sendAsync.mock.calls[0][0]).toEqual({
      roomId: 'room-2',
      data: {
        kind: 'image', body: 'IMG.jpg',
        clientRequestId: expect.stringMatching(/^forward-/),
        forwardOf: { roomId: 'room-1', messageId: 'msg-photo' },
      },
    });
    expect(sendAsync.mock.calls[1][0].data.forwardOf).toEqual({ roomId: 'room-1', messageId: 'msg-text' });
    expect(sendAsync.mock.calls[2][0]).toEqual({
      roomId: 'room-2',
      data: { kind: 'text', body: 'FYI', clientRequestId: expect.stringMatching(/^forward-/) },
    });
    expect(createAsync).not.toHaveBeenCalled();
    // Single recipient → land in that conversation.
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/customers/chat/room-2?name=Bob%20Repairs');
  });

  it('multi-select sends to every recipient and goes back', async () => {
    render(<ForwardScreen />);
    fireEvent.press(screen.getByTestId('forward-target-room:room-1'));
    fireEvent.press(screen.getByTestId('forward-target-room:room-2'));
    expect(screen.getByText('Alice, Bob Repairs')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });
    await waitFor(() => expect(sendAsync).toHaveBeenCalledTimes(4));
    expect(new Set(sendAsync.mock.calls.map((c) => c[0].roomId))).toEqual(new Set(['room-1', 'room-2']));
    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('a 10-digit search looks the number up on Avarpus and forwards by creating a direct room', async () => {
    matchAsync.mockResolvedValue({
      contacts: [{ userId: 'u-charlie', name: 'Charlie', mobile: '9876543210', role: 'dealer', matchToken: 'tok-1' }],
    });
    render(<ForwardScreen />);
    fireEvent.press(screen.getByTestId('forward-search-toggle'));
    fireEvent.changeText(screen.getByTestId('forward-search-input'), '+91 98765 43210');
    await waitFor(() => expect(matchAsync).toHaveBeenCalledWith({ data: { phones: ['9876543210'] } }));
    const target = await screen.findByTestId('forward-target-contact:u-charlie');
    fireEvent.press(target);
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });
    await waitFor(() => expect(createAsync).toHaveBeenCalledWith({
      data: { name: 'Charlie', kind: 'direct', targetUserId: 'u-charlie', matchToken: 'tok-1' },
    }));
    await waitFor(() => expect(sendAsync).toHaveBeenCalledTimes(2));
    expect(sendAsync.mock.calls.every((c) => c[0].roomId === 'room-new')).toBe(true);
  });

  it('contact-plus opens the device picker and a registered contact with an existing room reuses that room', async () => {
    mockGetContactsAsync.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Alice Phone', phoneNumbers: [{ number: '+91 91111 11111' }] },
        { id: 'c2', name: 'Nobody', phoneNumbers: [{ number: '9222222222' }] },
      ],
    });
    matchAsync.mockResolvedValue({
      contacts: [{ userId: 'other', name: 'Alice', mobile: '9111111111', role: 'dealer', matchToken: 'tok-a' }],
    });
    render(<ForwardScreen />);
    fireEvent.press(screen.getByTestId('forward-add-contact'));
    await waitFor(() => expect(matchAsync).toHaveBeenCalledWith({ data: { phones: ['9111111111', '9222222222'] } }));
    expect(await screen.findByText('Contacts on Avarpus')).toBeTruthy();
    expect(screen.getByText('Invite to Avarpus')).toBeTruthy();
    expect(screen.getByLabelText('Invite Nobody')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Forward to Alice'));
    // Existing direct room with that peer is reused instead of creating another.
    expect(screen.getByTestId('forward-target-room:room-1').props.accessibilityState).toEqual({ checked: true });
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });
    await waitFor(() => expect(sendAsync).toHaveBeenCalledTimes(2));
    expect(createAsync).not.toHaveBeenCalled();
    expect(sendAsync.mock.calls[0][0].roomId).toBe('room-1');
  });

  it('reports per-recipient failures without dropping the successful ones', async () => {
    const { Alert } = require('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    sendAsync.mockImplementation(async ({ roomId }: { roomId: string }) => {
      if (roomId === 'room-1') throw { data: { message: 'Blocked' } };
      return { message: { id: 'ok' } };
    });
    render(<ForwardScreen />);
    fireEvent.press(screen.getByTestId('forward-target-room:room-1'));
    fireEvent.press(screen.getByTestId('forward-target-room:room-2'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Some forwards failed', expect.stringContaining('Alice: Blocked')));
    expect(sendAsync.mock.calls.filter((c) => c[0].roomId === 'room-2')).toHaveLength(2);
    // Stay on the screen with only the failed recipient still selected.
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId('forward-target-room:room-1').props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('forward-target-room:room-2').props.accessibilityState).toEqual({ checked: false });

    // Retry replays the same idempotency keys for the failed recipient only.
    const firstAttemptIds = sendAsync.mock.calls.filter((c) => c[0].roomId === 'room-1').map((c) => c[0].data.clientRequestId);
    sendAsync.mockClear();
    sendAsync.mockResolvedValue({ message: { id: 'ok' } });
    await act(async () => {
      fireEvent.press(screen.getByTestId('forward-send'));
    });
    await waitFor(() => expect(sendAsync).toHaveBeenCalledTimes(2));
    expect(sendAsync.mock.calls.every((c) => c[0].roomId === 'room-1')).toBe(true);
    // The first attempt failed on the first message; the retry replays that exact key.
    expect(firstAttemptIds).toHaveLength(1);
    expect(sendAsync.mock.calls[0][0].data.clientRequestId).toBe(firstAttemptIds[0]);
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/customers/chat/room-1?name=Alice');
    alertSpy.mockRestore();
  });

  it('ignores a second press while a send is in flight', async () => {
    let release: () => void = () => undefined;
    sendAsync.mockImplementationOnce(() => new Promise<any>((resolve) => { release = () => resolve({ message: { id: 'ok' } }); }));
    render(<ForwardScreen />);
    fireEvent.press(screen.getByTestId('forward-target-room:room-2'));
    fireEvent.press(screen.getByTestId('forward-send'));
    fireEvent.press(screen.getByTestId('forward-send'));
    await act(async () => { release(); });
    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(sendAsync).toHaveBeenCalledTimes(2);
  });
});
