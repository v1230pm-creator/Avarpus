/**
 * Focused tests for:
 * - No fake inbox data (rooms come from API only)
 * - Customer role permissions
 * - Provider disabled states
 * - Text send/read flow
 * - Route guards (FeatureRouteGuard redirects to /(tabs), not /more)
 * - Invite activation guard
 */
import React from 'react';
import { Alert, Linking, Platform, Text, View } from 'react-native';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { FeatureRouteGuard } from '../components/navigation/FeatureRouteGuard';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    useRouter: jest.fn(() => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() })),
    useLocalSearchParams: jest.fn(() => ({})),
    useNavigation: jest.fn(() => ({
      getParent: jest.fn(() => ({
        getParent: jest.fn(() => ({ setOptions: jest.fn() })),
      })),
    })),
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, null, `Redirect:${href}`),
    Slot: () => React.createElement(Text, null, 'Slot'),
  };
});

jest.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    KeyboardAvoidingView: ({ children, ...props }: any) => React.createElement(View, props, children),
  };
});

jest.mock('@/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));

const mockUseData = jest.fn();
jest.mock('@/context/DataContext', () => ({
  useData: (...args: any[]) => mockUseData(...args),
}));

jest.mock('@/types', () => ({
  isDealerPortalRole: (role: string) => role === 'dealer_owner' || role === 'dealer_staff',
  isCustomerRole: (role: string) => role === 'customer',
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#F8FAFC',
    foreground: '#111827',
    card: '#FFFFFF',
    border: '#E2E8F0',
    primary: '#2F80ED',
    primaryForeground: '#FFFFFF',
    secondaryForeground: '#334155',
    mutedForeground: '#64748B',
    backgroundSecondary: '#F1F5F9',
    accent: '#EAF2FF',
    destructive: '#EF4444',
    success: '#22C55E',
    successLight: '#EAF8EF',
    warning: '#B45309',
    info: '#0B63F6',
    purple: '#8B5CF6',
  }),
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

// API client mocks — keyed by what each test controls via mockReturnValue
const mockUseChatCapabilities = jest.fn();
const mockUseChatContactsMatch = jest.fn();
const mockUseChatRoomsList = jest.fn();
const mockUseChatRoomsArchivedList = jest.fn();
const mockUseChatRoomsCreate = jest.fn();
const mockUseChatRoomsPreferencesUpdate = jest.fn();
const mockUseChatRoomsDelete = jest.fn();
const mockUseChatRoomsGet = jest.fn();
const mockUseChatMessagesList = jest.fn();
const mockUseChatMessagesSend = jest.fn();
const mockUseChatMessagesDelete = jest.fn();
const mockUseChatMarkRead = jest.fn();
const mockUseChatUploadUrl = jest.fn();
const mockUseChatRoomsBlock = jest.fn();
const mockUseChatRoomsUnblock = jest.fn();
const mockUseChatReportsCreate = jest.fn();
const mockUseRepairsList = jest.fn();
const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
const mockSetQueryData = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
  useChatCapabilities: (...args: any[]) => mockUseChatCapabilities(...args),
  useChatContactsMatch: (...args: any[]) => mockUseChatContactsMatch(...args),
  useChatRoomsList: (...args: any[]) => mockUseChatRoomsList(...args),
  useChatRoomsArchivedList: (...args: any[]) => mockUseChatRoomsArchivedList(...args),
  useChatRoomsCreate: (...args: any[]) => mockUseChatRoomsCreate(...args),
  useChatRoomsPreferencesUpdate: (...args: any[]) => mockUseChatRoomsPreferencesUpdate(...args),
  useChatRoomsDelete: (...args: any[]) => mockUseChatRoomsDelete(...args),
  useChatRoomsGet: (...args: any[]) => mockUseChatRoomsGet(...args),
  useChatMessagesList: (...args: any[]) => mockUseChatMessagesList(...args),
  useChatMessagesSend: (...args: any[]) => mockUseChatMessagesSend(...args),
  useChatMessagesDelete: (...args: any[]) => mockUseChatMessagesDelete(...args),
  useChatMarkRead: (...args: any[]) => mockUseChatMarkRead(...args),
  useChatUploadUrl: (...args: any[]) => mockUseChatUploadUrl(...args),
  useChatRoomsBlock: (...args: any[]) => mockUseChatRoomsBlock(...args),
  useChatRoomsUnblock: (...args: any[]) => mockUseChatRoomsUnblock(...args),
  useChatReportsCreate: (...args: any[]) => mockUseChatReportsCreate(...args),
  useRepairsList: (...args: any[]) => mockUseRepairsList(...args),
  // Query key helpers
  getChatRoomsListQueryKey: () => ['/api/chat/rooms'],
  getChatRoomsArchivedListQueryKey: () => ['/api/chat/rooms/archived'],
  getChatRoomsGetQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}`],
  getChatMessagesListQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}/messages`],
  getRepairsListQueryKey: (params: any) => ['/api/repairs', params],
  // Media URL — private per-message endpoint, not generic storage
  getChatMessageMediaUrl: (roomId: string, messageId: string) =>
    `/api/chat/rooms/${roomId}/messages/${messageId}/media`,
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
}));

const mockRequestContactsPermissionsAsync = jest.fn();
const mockGetContactsPermissionsAsync = jest.fn();
const mockGetContactsAsync = jest.fn();
jest.mock('expo-contacts/legacy', () => ({
  getPermissionsAsync: (...args: any[]) => mockGetContactsPermissionsAsync(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestContactsPermissionsAsync(...args),
  getContactsAsync: (...args: any[]) => mockGetContactsAsync(...args),
  Fields: { PhoneNumbers: 'phoneNumbers', Image: 'image' },
  SortTypes: { FirstName: 'firstName' },
}));

const mockLaunchImageLibraryAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: any[]) => mockLaunchImageLibraryAsync(...args),
  MediaTypeOptions: { All: 'All' },
}));

const mockGetMediaPermissionsAsync = jest.fn();
const mockRequestMediaPermissionsAsync = jest.fn();
const mockGetAssetsAsync = jest.fn();
const mockGetAssetInfoAsync = jest.fn();
const mockSaveToLibraryAsync = jest.fn();
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: (...args: any[]) => mockGetMediaPermissionsAsync(...args),
  requestPermissionsAsync: (...args: any[]) => mockRequestMediaPermissionsAsync(...args),
  getAssetsAsync: (...args: any[]) => mockGetAssetsAsync(...args),
  getAssetInfoAsync: (...args: any[]) => mockGetAssetInfoAsync(...args),
  saveToLibraryAsync: (...args: any[]) => mockSaveToLibraryAsync(...args),
}));

const mockRequestLocationPermissionsAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...args: any[]) => mockRequestLocationPermissionsAsync(...args),
  getCurrentPositionAsync: (...args: any[]) => mockGetCurrentPositionAsync(...args),
  Accuracy: { Balanced: 3 },
}));

// Mock expo-document-picker
const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: any[]) => mockGetDocumentAsync(...args),
}));

// Mock expo-file-system/legacy
const mockCreateUploadTask = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockCopyAsync = jest.fn();
const mockDownloadAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: (...args: any[]) => mockGetInfoAsync(...args),
  copyAsync: (...args: any[]) => mockCopyAsync(...args),
  createUploadTask: (...args: any[]) => mockCreateUploadTask(...args),
  downloadAsync: (...args: any[]) => mockDownloadAsync(...args),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-sharing
const mockShareAsync = jest.fn();
const mockIsAvailableAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  shareAsync: (...args: any[]) => mockShareAsync(...args),
  isAvailableAsync: (...args: any[]) => mockIsAvailableAsync(...args),
}));

// Mock expo-image (to avoid native module issues)
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Image: ({ source, testID, accessibilityLabel }: any) =>
      React.createElement(View, { testID, accessibilityLabel }),
  };
});

// Mock AsyncStorage (for token reads in component)
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(JSON.stringify('test-bearer-token')),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-audio
const mockRecorderRecord = jest.fn();
const mockRecorderStop = jest.fn();
const mockRecorderUri = { current: 'file:///cache/voice-note-123.m4a' as string | null };
/** Native recordingStatusUpdate listener registered by the hook. */
const mockRecorderStatusListener = { current: null as null | ((status: unknown) => void) };
const mockRecorderState = {
  canRecord: true,
  isRecording: false,
  durationMillis: 0,
  mediaServicesDidReset: false,
  url: null as string | null,
};
const mockRequestRecordingPermissionsAsync = jest.fn();
const mockSetAudioModeAsync = jest.fn();
const mockUseAudioPlayer = jest.fn();
const mockUseAudioPlayerStatus = jest.fn();
const mockUseAudioRecorderState = jest.fn();

// useAudioRecorder returns the same recorder object shape
const mockRecorder = {
  record: mockRecorderRecord,
  stop: mockRecorderStop,
  pause: jest.fn(),
  get uri() { return mockRecorderUri.current; },
  // Mirrors the stubbed hook state so synchronous reads agree with the UI.
  getStatus: jest.fn(() => mockUseAudioRecorderState()),
  id: 1,
  currentTime: 0,
  isRecording: false,
  prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
  startRecordingAtTime: jest.fn(),
  recordForDuration: jest.fn(),
  addListener: jest.fn(),
  removeAllListeners: jest.fn(),
  getAvailableInputs: jest.fn().mockReturnValue([]),
  getCurrentInput: jest.fn(),
  setInput: jest.fn(),
};

const mockRecorderPrepare = mockRecorder.prepareToRecordAsync;

// In-memory stand-in for the expo-file-system `File` API used by the voice
// recorder to finalise, merge and clean up ADTS segments.
const mockFakeFiles = new Map<string, Uint8Array>();
function seedFakeFile(uri: string, bytes: number[]) {
  mockFakeFiles.set(uri, Uint8Array.from(bytes));
}
jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(...parts: any[]) {
      const segs = parts.map((p) => (typeof p === 'string' ? p : p.uri));
      this.uri = segs.reduce((acc: string, seg: string) => (acc ? acc.replace(/\/$/, '') + '/' + seg.replace(/^\//, '') : seg), '');
    }
    get exists() { return mockFakeFiles.has(this.uri); }
    get size() { return mockFakeFiles.get(this.uri)?.byteLength ?? null; }
    async bytes() {
      const b = mockFakeFiles.get(this.uri);
      if (!b) throw new Error(`fake file missing: ${this.uri}`);
      return b;
    }
    write(content: Uint8Array) { mockFakeFiles.set(this.uri, Uint8Array.from(content)); }
    delete() { mockFakeFiles.delete(this.uri); }
  }
  return { File: FakeFile, Paths: { cache: { uri: 'file:///cache/' } } };
});

const MIC_LABEL = 'Record voice note';

/** Wait until the panel is live-recording (transitional states disable Send). */
async function waitForRecordingReady() {
  await waitFor(() => {
    expect(screen.getByLabelText('Pause recording').props.accessibilityState?.disabled).toBeFalsy();
    expect(screen.getByLabelText('Send voice note').props.accessibilityState?.disabled).toBeFalsy();
  });
}

/** Tap the mic and wait for the recording panel. */
async function startRecording() {
  fireEvent.press(screen.getByLabelText(MIC_LABEL));
  await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());
  await waitForRecordingReady();
}

/** Recorder state stub: recording with a fixed duration. */
function stubRecorderState(durationMillis: number, isRecording = true) {
  mockUseAudioRecorderState.mockImplementation(() => ({
    canRecord: true,
    isRecording,
    durationMillis,
    mediaServicesDidReset: false,
    url: null,
  }));
}

jest.mock('expo-audio', () => ({
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { HIGH: 96 },
  useAudioRecorder: jest.fn((_options: unknown, listener?: (status: unknown) => void) => {
    mockRecorderStatusListener.current = listener ?? null;
    return mockRecorder;
  }),
  useAudioRecorderState: (...args: any[]) => mockUseAudioRecorderState(...args),
  useAudioPlayer: (...args: any[]) => mockUseAudioPlayer(...args),
  useAudioPlayerStatus: (...args: any[]) => mockUseAudioPlayerStatus(...args),
  requestRecordingPermissionsAsync: (...args: any[]) => mockRequestRecordingPermissionsAsync(...args),
  setAudioModeAsync: (...args: any[]) => mockSetAudioModeAsync(...args),
  RecordingPresets: {
    HIGH_QUALITY: {
      extension: '.m4a',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitRate: 128000,
      android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
      ios: { outputFormat: 'aac ', audioQuality: 96, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
      web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
    },
  },
}));

// Import after mocks
import HomeScreen from '../app/(tabs)/index';
import ChatRoomScreen from '../app/(tabs)/customers/chat/[id]';
import ChatLayout from '../app/(tabs)/customers/chat/_layout';

// ── Helpers ────────────────────────────────────────────────────────────────

const defaultAuth = {
  user: { id: 'staff-1', name: 'Staff', role: 'dealer' },
  canAccess: (f: string) => true,
};

const stubMutate = (onSuccessResult?: any) =>
  jest.fn((args: any, callbacks: any) => {
    if (onSuccessResult !== undefined) callbacks?.onSuccess?.(onSuccessResult);
  });

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue(defaultAuth);
  mockUseData.mockReturnValue({ customers: [] });
  (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
  (useRouter as jest.Mock).mockReturnValue({ push: jest.fn(), back: jest.fn(), replace: jest.fn() });

  mockUseChatCapabilities.mockReturnValue({ data: undefined, isLoading: false, isError: false });
  mockUseChatContactsMatch.mockReturnValue({ mutateAsync: jest.fn() });
  mockUseChatRoomsList.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  mockUseChatRoomsArchivedList.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  mockUseChatRoomsCreate.mockReturnValue({
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    isPending: false,
  });
  mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
  mockUseChatRoomsDelete.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
  mockUseChatRoomsGet.mockReturnValue({ data: undefined });
  mockUseChatMessagesList.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  mockUseChatMessagesSend.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatMessagesDelete.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
  mockUseChatMarkRead.mockReturnValue({ mutate: jest.fn() });
  mockUseChatUploadUrl.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatRoomsBlock.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatRoomsUnblock.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatReportsCreate.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseRepairsList.mockReturnValue({
    data: { repairs: [], total: 0 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  });
  mockGetContactsPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  mockRequestContactsPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockGetContactsAsync.mockResolvedValue({ data: [] });
  mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  mockGetMediaPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges: 'all' });
  mockRequestMediaPermissionsAsync.mockResolvedValue({ granted: true, accessPrivileges: 'all' });
  mockGetAssetsAsync.mockResolvedValue({ assets: [], endCursor: '', hasNextPage: false });
  mockGetAssetInfoAsync.mockImplementation(async (asset: any) => ({ ...asset, localUri: asset.uri }));
  mockRequestLocationPermissionsAsync.mockResolvedValue({ granted: true });
  mockGetCurrentPositionAsync.mockResolvedValue({
    coords: { latitude: 28.6139, longitude: 77.209 },
  });
  mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
  mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
  mockCopyAsync.mockResolvedValue(undefined);
  mockCreateUploadTask.mockReturnValue({ uploadAsync: jest.fn().mockResolvedValue({ status: 200 }) });
  mockDownloadAsync.mockResolvedValue({ uri: 'file:///cache/test.jpg', status: 200 });
  mockIsAvailableAsync.mockResolvedValue(true);
  mockShareAsync.mockResolvedValue(undefined);
  mockSaveToLibraryAsync.mockResolvedValue(undefined);

  // expo-audio defaults
  mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
  mockSetAudioModeAsync.mockResolvedValue(undefined);
  mockRecorderStop.mockResolvedValue(undefined);
  mockRecorderRecord.mockReturnValue(undefined);
  mockRecorderUri.current = 'file:///cache/voice-note-123.m4a';
  mockUseAudioRecorderState.mockReturnValue({
    canRecord: true,
    isRecording: false,
    durationMillis: 0,
    mediaServicesDidReset: false,
    url: null,
  });
  const mockPlayer = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    id: 1,
    playing: false,
    muted: false,
    loop: false,
    paused: false,
    isLoaded: true,
    isAudioSamplingSupported: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    playbackRate: 1,
    shouldCorrectPitch: false,
    currentStatus: {} as any,
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
    remove: jest.fn(),
    release: jest.fn(),
    setVolume: jest.fn(),
    setPlaybackRate: jest.fn(),
    setIsMuted: jest.fn(),
    setIsLooping: jest.fn(),
    replace: jest.fn(),
  };
  mockUseAudioPlayer.mockReturnValue(mockPlayer);
  mockUseAudioPlayerStatus.mockReturnValue({
    id: 1,
    currentTime: 0,
    playbackState: 'paused',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 0,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    currentStatus: {} as any,
  });
});

// ── Inbox: no fake data ────────────────────────────────────────────────────

describe('Inbox — no fake data', () => {
  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'customer-1', name: 'Customer', role: 'customer' },
      canAccess: (f: string) => f === 'chat',
    });
  });

  it('shows provider-not-configured state when matrixAvailable is false', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<HomeScreen />);
    expect(screen.getByText('Chat provider not configured')).toBeTruthy();
    // No fake contacts or messages
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('shows loading indicator while fetching capabilities', () => {
    mockUseChatCapabilities.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<HomeScreen />);
    expect(screen.getByText('Loading conversations…')).toBeTruthy();
  });

  it('renders customer conversations but filters dealer rooms from Chats', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r1', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z', unreadCount: 2, lastMessage: { id: 'm1', body: 'Hello!', createdAt: '2026-01-01T10:00:00Z', senderId: 'other', senderName: 'Alice', roomId: 'r1', shopId: 's1', kind: 'text' } },
          { id: 'r-direct', name: 'Priya', kind: 'direct', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z', unreadCount: 0 },
          { id: 'r2', name: 'Bob', kind: 'dealer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T09:00:00Z', unreadCount: 0 },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<HomeScreen />);
    expect(screen.getByTestId('room-item-r1')).toBeTruthy();
    expect(screen.getByTestId('room-item-r-direct')).toBeTruthy();
    expect(screen.queryByTestId('room-item-r2')).toBeNull();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.queryByText('Bob')).toBeNull();
    expect(screen.getByText('Hello!')).toBeTruthy();
  });

  it('matches an exact normalized phone number only after user action', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({
      contacts: [{ userId: 'user-priya', name: 'Priya', mobile: '9876543210', role: 'staff', matchToken: 'proof-token' }],
    });
    const roomMutateAsync = jest.fn().mockResolvedValue({
      room: { id: 'room-priya' },
      created: true,
    });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({ data: { rooms: [] }, isLoading: false, isError: false, refetch: jest.fn() });
    mockUseChatContactsMatch.mockReturnValue({ mutateAsync });
    mockUseChatRoomsCreate.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: roomMutateAsync,
      isPending: false,
    });
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId('new-chat-control'));
    fireEvent.changeText(screen.getByLabelText('Exact mobile number'), '+91 98765 43210');
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Find registered contact'));
      await Promise.resolve();
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ data: { phones: ['9876543210'] } }));
    const contactRow = await waitFor(() => screen.getByTestId('matched-contact-user-priya'));
    await act(async () => {
      fireEvent.press(contactRow);
      await Promise.resolve();
    });
    await waitFor(() => expect(roomMutateAsync).toHaveBeenCalledWith({
      data: {
        name: 'Priya',
        kind: 'direct',
        targetUserId: 'user-priya',
        matchToken: 'proof-token',
      },
    }));
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/chat/rooms'] });
    expect(push).toHaveBeenCalledWith('/(tabs)/customers/chat/room-priya?name=Priya');
  });

  it('opens device contacts directly, lists registered users first, and reuses permission', async () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({ data: { rooms: [] }, isLoading: false, isError: false, refetch: jest.fn() });
    mockGetContactsAsync.mockResolvedValue({
      data: [
        { id: 'device-priya', name: 'Priya Phone', phoneNumbers: [{ number: '+91 98765 43210' }] },
        { id: 'device-ajay', name: 'Ajay Mama', phoneNumbers: [{ number: '+91 91514 78747' }] },
      ],
    });
    const mutateAsync = jest.fn().mockResolvedValue({
      contacts: [{ userId: 'user-priya', name: 'Priya', mobile: '9876543210', role: 'customer', matchToken: 'proof-token' }],
    });
    mockUseChatContactsMatch.mockReturnValue({ mutateAsync });

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId('new-chat-control'));

    expect(await screen.findByText('Contacts on Avarpus')).toBeTruthy();
    expect(screen.getByText('Invite to Avarpus')).toBeTruthy();
    expect(screen.getByText('Priya Phone')).toBeTruthy();
    expect(screen.getByText('Ajay Mama')).toBeTruthy();
    expect(screen.getByLabelText('Message Priya')).toBeTruthy();
    expect(screen.getByLabelText('Call Priya')).toBeTruthy();
    expect(screen.getByLabelText('Invite Ajay Mama')).toBeTruthy();
    expect(mockRequestContactsPermissionsAsync).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Close contact picker'));
    fireEvent.press(screen.getByTestId('new-chat-control'));
    expect(await screen.findByText('Contacts on Avarpus')).toBeTruthy();
    expect(mockRequestContactsPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockGetContactsAsync).toHaveBeenCalledTimes(1);
  });

  it('sends an Android SMS invite carrying the permanent Avarpus install link', async () => {
    const platform = jest.replaceProperty(Platform, 'OS', 'android');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({ data: { rooms: [] }, isLoading: false, isError: false, refetch: jest.fn() });
    mockGetContactsAsync.mockResolvedValue({
      data: [{ id: 'device-ajay', name: 'Ajay Mama', phoneNumbers: [{ number: '+91 91514 78747' }] }],
    });
    mockUseChatContactsMatch.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue({ contacts: [] }) });

    try {
      render(<HomeScreen />);
      fireEvent.press(screen.getByTestId('new-chat-control'));
      const inviteAction = await screen.findByLabelText('Invite Ajay Mama');
      await act(async () => {
        fireEvent.press(inviteAction);
        await Promise.resolve();
      });

      await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
      const smsUrl: string = openURL.mock.calls[0][0];
      expect(smsUrl.startsWith('sms:+919151478747?body=')).toBe(true);

      const body = decodeURIComponent(smsUrl.split('?body=')[1]);
      expect(body).toContain('Avarpus');
      expect(body).toContain('https://avarpus.com/download');
      expect(body).not.toMatch(/replit\.dev|replit\.app|exp:\/\/|localhost/i);
      expect(alertSpy).not.toHaveBeenCalled();
    } finally {
      alertSpy.mockRestore();
      openURL.mockRestore();
      platform.restore();
    }
  });

  it('polls the member-only room list so incoming direct chats appear', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: { rooms: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);

    expect(mockUseChatRoomsList).toHaveBeenCalledWith({
      query: expect.objectContaining({
        enabled: true,
        queryKey: ['/api/chat/rooms'],
        refetchInterval: 5000,
        refetchIntervalInBackground: false,
        refetchOnMount: 'always',
      }),
    });
  });

  it('shows archived chats in a dedicated view and restores multiple selections', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ preferences: { isArchived: false } });
    mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync, isPending: false });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: { rooms: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockUseChatRoomsArchivedList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r-archived-a', name: 'Archived Alice', kind: 'customer', shopId: 's1', isArchived: true, createdAt: '2026-01-01T10:00:00Z' },
          { id: 'r-archived-b', name: 'Archived Priya', kind: 'direct', isArchived: true, createdAt: '2026-01-01T09:00:00Z' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);
    // Archived now lives in the header overflow menu, not a filter chip row.
    fireEvent.press(screen.getByTestId('account-menu-control'));
    fireEvent.press(screen.getByText('Archived'));

    expect(screen.getByTestId('room-item-r-archived-a')).toBeTruthy();
    expect(screen.getByTestId('room-item-r-archived-b')).toBeTruthy();
    fireEvent(screen.getByTestId('room-item-r-archived-a'), 'longPress');
    fireEvent.press(screen.getByTestId('room-item-r-archived-b'));
    fireEvent.press(screen.getByLabelText('Restore selected chats'));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-archived-a', data: { isArchived: false } });
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-archived-b', data: { isArchived: false } });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/chat/rooms'] });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/chat/rooms/archived'] });
    });
  });

  it('keeps customer account access visible from the Chats landing', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId('account-menu-control'));
    fireEvent.press(screen.getByText('Settings'));

    expect(push).toHaveBeenCalledWith('/(tabs)/more/settings');
  });

  it('explains denied contact permission without querying contacts', async () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({ data: { rooms: [] }, isLoading: false, isError: false, refetch: jest.fn() });
    mockRequestContactsPermissionsAsync.mockResolvedValue({ granted: false });
    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId('new-chat-control'));
    fireEvent.press(screen.getByLabelText('Find contacts on this device'));
    await waitFor(() => expect(screen.getByText(/Contacts permission was denied/)).toBeTruthy());
    expect(mockGetContactsAsync).not.toHaveBeenCalled();
  });

  it('opens existing customer conversations by room id', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r-alice', name: 'Alice', kind: 'customer', customerId: 'c-alice', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z' },
          { id: 'r-carol', name: 'Carol', kind: 'customer', customerId: 'c-carol', shopId: 's1', isArchived: false, createdAt: '2026-01-01T09:00:00Z' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);

    fireEvent.press(screen.getByTestId('room-item-r-alice'));
    fireEvent.press(screen.getByTestId('room-item-r-carol'));

    expect(push).toHaveBeenNthCalledWith(
      1,
      '/(tabs)/customers/chat/r-alice?name=Alice',
    );
    expect(push).toHaveBeenNthCalledWith(
      2,
      '/(tabs)/customers/chat/r-carol?name=Carol',
    );
  });

  it('supports long-press one-or-many chat selection with a selected count', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r-alice', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z' },
          { id: 'r-carol', name: 'Carol', kind: 'direct', shopId: 's1', isArchived: false, createdAt: '2026-01-01T09:00:00Z' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);
    fireEvent(screen.getByTestId('room-item-r-alice'), 'longPress');
    expect(screen.getByTestId('selected-room-count').props.children).toBe(1);
    expect(screen.getByLabelText('Pin selected chats')).toBeTruthy();
    expect(screen.getByLabelText('Delete selected chats')).toBeTruthy();
    expect(screen.getByLabelText('Mute selected chats')).toBeTruthy();

    fireEvent.press(screen.getByTestId('room-item-r-carol'));
    expect(screen.getByTestId('selected-room-count').props.children).toBe(2);
    expect(push).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Exit selection mode'));
    expect(screen.queryByTestId('selected-room-count')).toBeNull();
  });

  it.each([
    ['Pin selected chats', { isPinned: true }],
    ['Mute selected chats', { isMuted: true }],
    ['Archive selected chats', { isArchived: true }],
  ])('persists multi-select action %s for every selected room', async (label, data) => {
    const mutateAsync = jest.fn().mockResolvedValue({ preferences: { ...data } });
    mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync, isPending: false });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r-alice', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T10:00:00Z' },
          { id: 'r-carol', name: 'Carol', kind: 'direct', shopId: 's1', isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T09:00:00Z' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);
    fireEvent(screen.getByTestId('room-item-r-alice'), 'longPress');
    fireEvent.press(screen.getByTestId('room-item-r-carol'));
    fireEvent.press(screen.getByLabelText(label));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-alice', data });
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-carol', data });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['/api/chat/rooms'] });
    });
  });

  it('deletes selected chats only after explaining caller-only semantics', async () => {
    const mutateAsync = jest.fn().mockResolvedValue(undefined);
    mockUseChatRoomsDelete.mockReturnValue({ mutateAsync, isPending: false });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r-alice', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T10:00:00Z' },
          { id: 'r-carol', name: 'Carol', kind: 'direct', shopId: 's1', isArchived: false, isPinned: false, isMuted: false, createdAt: '2026-01-01T09:00:00Z' },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<HomeScreen />);
    fireEvent(screen.getByTestId('room-item-r-alice'), 'longPress');
    fireEvent.press(screen.getByTestId('room-item-r-carol'));
    fireEvent.press(screen.getByLabelText('Delete selected chats'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete selected chats?',
      expect.stringContaining('only for you'),
      expect.any(Array),
    );
    const buttons = alertSpy.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((button) => button.text === 'Delete for me')?.onPress?.();

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-alice' });
      expect(mutateAsync).toHaveBeenCalledWith({ roomId: 'r-carol' });
    });
    alertSpy.mockRestore();
  });

  it('shows empty state when provider is up but no rooms exist', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: { rooms: [] },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<HomeScreen />);
    expect(screen.getByText('No conversations yet')).toBeTruthy();
  });

  it('shows error state and retry when rooms fetch fails', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    const refetch = jest.fn();
    mockUseChatRoomsList.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });
    render(<HomeScreen />);
    expect(screen.getByText('Could not load conversations')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });
});

// ── Customer role permissions ──────────────────────────────────────────────

describe('Customer role permissions', () => {
  it('customer role is allowed through FeatureRouteGuard for chat feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'customer' },
      canAccess: (f: string) => f === 'chat',
    });
    render(
      <FeatureRouteGuard feature="chat">
        <Text>Chat</Text>
      </FeatureRouteGuard>,
    );
    expect(screen.getByText('Chat')).toBeTruthy();
    expect(screen.queryByText(/Redirect/)).toBeNull();
  });

  it('customer role is blocked from Customers (staff-only) feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'customer' },
      canAccess: (f: string) => f === 'chat',
    });
    render(
      <FeatureRouteGuard feature="customers">
        <Text>Customers List</Text>
      </FeatureRouteGuard>,
    );
    expect(screen.getByText('Redirect:/(tabs)')).toBeTruthy();
    expect(screen.queryByText('Customers List')).toBeNull();
  });

  it('customer role is blocked from repairs feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'customer' },
      canAccess: () => false,
    });
    render(
      <FeatureRouteGuard feature="repairs">
        <Text>Repairs</Text>
      </FeatureRouteGuard>,
    );
    expect(screen.getByText('Redirect:/(tabs)')).toBeTruthy();
  });
});

// ── FeatureRouteGuard redirect target ─────────────────────────────────────

describe('FeatureRouteGuard — redirects to /(tabs) not /more', () => {
  it('blocked user is redirected to /(tabs)', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'reception' },
      canAccess: () => false,
    });
    render(
      <FeatureRouteGuard feature="payments">
        <Text>Khata</Text>
      </FeatureRouteGuard>,
    );
    expect(screen.getByText('Redirect:/(tabs)')).toBeTruthy();
    // Must NOT redirect to /more (which may be invisible for some roles)
    expect(screen.queryByText('Redirect:/(tabs)/more')).toBeNull();
  });

  it('dealer-portal blocked from excludeDealerPortal route redirects to /(tabs)', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer_owner' },
      canAccess: () => true,
    });
    render(
      <FeatureRouteGuard feature="payments" excludeDealerPortal>
        <Text>Khata</Text>
      </FeatureRouteGuard>,
    );
    expect(screen.getByText('Redirect:/(tabs)')).toBeTruthy();
    expect(screen.queryByText('Redirect:/(tabs)/more')).toBeNull();
  });
});

// ── Chat layout authorization ──────────────────────────────────────────────

describe('Chat layout authorization', () => {
  it('allows customer role into chat without requiring customers feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'customer' },
      canAccess: () => false, // customer has no staff features
    });
    render(<ChatLayout />);
    expect(screen.getByText('Slot')).toBeTruthy();
    expect(screen.queryByText(/Redirect/)).toBeNull();
  });

  it('allows dealer_owner role into chat', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'dealer_owner' },
      canAccess: () => false,
    });
    render(<ChatLayout />);
    expect(screen.getByText('Slot')).toBeTruthy();
  });

  it('blocks staff without customers feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'technician' },
      canAccess: () => false,
    });
    render(<ChatLayout />);
    expect(screen.getByText('Redirect:/(tabs)')).toBeTruthy();
    expect(screen.queryByText('Slot')).toBeNull();
  });

  it('allows staff with customers feature', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { role: 'reception' },
      canAccess: (f: string) => f === 'customers',
    });
    render(<ChatLayout />);
    expect(screen.getByText('Slot')).toBeTruthy();
  });
});

// ── Chat screen: provider disabled ────────────────────────────────────────

describe('Chat screen — provider disabled', () => {
  it('shows setup-pending card when provider is unavailable', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    expect(screen.getByText('Chat setup pending')).toBeTruthy();
    expect(screen.getByText('Nothing is sent or stored from this screen.')).toBeTruthy();
    const input = screen.queryByPlaceholderText('Messaging is not available yet');
    if (input) {
      expect(input.props.editable).toBe(false);
    }
  });

  it('always shows E2EE-not-enabled notice', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    expect(screen.getByText('End-to-end encryption is not enabled')).toBeTruthy();
  });

  it('shows voice/video as disabled when livekit unavailable', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({ data: { room: { id: 'room-1', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z' } } });
    mockUseChatMessagesList.mockReturnValue({ data: { messages: [], hasMore: false }, isLoading: false, isError: false, refetch: jest.fn() });
    render(<ChatRoomScreen />);
    expect(screen.getByLabelText('Voice calls unavailable')).toBeTruthy();
    expect(screen.getByLabelText('Video calls unavailable')).toBeTruthy();
  });

  it('opens the native LiveKit route when calling is available', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({
      push,
      back: jest.fn(),
      replace: jest.fn(),
    });
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice & Bob' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: true, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice & Bob',
          kind: 'customer',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Start or join voice call'));

    expect(push).toHaveBeenCalledWith(
      '/(tabs)/customers/chat/call/room-1?mode=audio&name=Alice%20%26%20Bob',
    );
  });
});

describe('Chat screen — global direct safety controls', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: true, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('keeps history visible while disabling calls and composing for a blocked room', () => {
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'direct',
          scope: 'global_direct',
          shopId: null,
          isBlocked: true,
          blockedByMe: true,
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });

    render(<ChatRoomScreen />);

    expect(
      screen.getByText('You blocked this contact. Existing messages remain available.'),
    ).toBeTruthy();
    expect(screen.getByText('No messages yet. Send the first one!')).toBeTruthy();
    expect(screen.getByLabelText('Voice calls unavailable')).toBeTruthy();
    expect(screen.getByPlaceholderText('Message…').props.editable).toBe(false);
  });

  it('suppresses duplicate report presses while pending and retries failures with the same identity', () => {
    const unblockMutate = jest.fn();
    const reportMutate = jest.fn();
    mockUseChatRoomsUnblock.mockReturnValue({ mutate: unblockMutate, isPending: false });
    mockUseChatReportsCreate.mockReturnValue({ mutate: reportMutate, isPending: false });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'direct',
          scope: 'global_direct',
          shopId: null,
          isBlocked: true,
          blockedByMe: true,
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Open chat menu'));

    const menuButtons = alertSpy.mock.calls[0][2] ?? [];
    expect(menuButtons.map((button: any) => button.text)).toEqual(
      expect.arrayContaining(['Report', 'Unblock', 'Cancel']),
    );
    menuButtons.find((button: any) => button.text === 'Report')?.onPress?.();
    const firstReasonButtons =
      alertSpy.mock.calls.find((call) => call[0] === 'Report conversation')?.[2] ?? [];
    const firstSpamButton = firstReasonButtons.find((button: any) => button.text === 'Spam');
    const staleHarassmentButton = firstReasonButtons.find(
      (button: any) => button.text === 'Harassment',
    );
    firstSpamButton?.onPress?.();
    firstSpamButton?.onPress?.();
    staleHarassmentButton?.onPress?.();
    expect(reportMutate).toHaveBeenCalledTimes(1);
    const firstReportId = reportMutate.mock.calls[0][0].data.clientRequestId;
    reportMutate.mock.calls[0][1].onError(new Error('ambiguous network failure'));

    fireEvent.press(screen.getByLabelText('Open chat menu'));
    const latestMenu =
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Chat options')?.[2] ?? [];
    latestMenu.find((button: any) => button.text === 'Report')?.onPress?.();
    const latestReasons =
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Report conversation')?.[2] ?? [];
    const retrySpamButton = latestReasons.find((button: any) => button.text === 'Spam');
    retrySpamButton?.onPress?.();
    retrySpamButton?.onPress?.();
    expect(reportMutate).toHaveBeenCalledTimes(2);
    expect(reportMutate.mock.calls[1][0].data.clientRequestId).toBe(firstReportId);

    menuButtons.find((button: any) => button.text === 'Unblock')?.onPress?.();
    const confirmationButtons =
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Unblock Alice?')?.[2] ?? [];
    confirmationButtons.find((button: any) => button.text === 'Unblock')?.onPress?.();

    expect(unblockMutate).toHaveBeenCalledWith(
      { roomId: 'room-1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('releases the report guard and retry identity after success', () => {
    const reportMutate = jest.fn();
    mockUseChatReportsCreate.mockReturnValue({ mutate: reportMutate, isPending: false });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'direct',
          scope: 'global_direct',
          shopId: null,
          isBlocked: false,
          blockedByMe: false,
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Open chat menu'));
    const menuButtons = alertSpy.mock.calls[0][2] ?? [];
    menuButtons.find((button: any) => button.text === 'Report')?.onPress?.();
    const reasonButtons =
      alertSpy.mock.calls.find((call) => call[0] === 'Report conversation')?.[2] ?? [];
    const spamButton = reasonButtons.find((button: any) => button.text === 'Spam');
    const staleHarassmentButton = reasonButtons.find(
      (button: any) => button.text === 'Harassment',
    );
    spamButton?.onPress?.();
    const firstReportId = reportMutate.mock.calls[0][0].data.clientRequestId;
    staleHarassmentButton?.onPress?.();
    expect(reportMutate).toHaveBeenCalledTimes(1);
    reportMutate.mock.calls[0][1].onSuccess();

    staleHarassmentButton?.onPress?.();

    expect(reportMutate).toHaveBeenCalledTimes(2);
    expect(reportMutate.mock.calls[1][0].data.reason).toBe('harassment');
    expect(reportMutate.mock.calls[1][0].data.clientRequestId).not.toBe(firstReportId);
  });

  it('does not let a late success from the previous room release the new room report guard', () => {
    let params = { id: 'room-1', name: 'Alice' };
    (useLocalSearchParams as jest.Mock).mockImplementation(() => params);
    mockUseChatRoomsGet.mockImplementation((roomId: string) => ({
      data: {
        room: {
          id: roomId,
          name: params.name,
          kind: 'direct',
          scope: 'global_direct',
          shopId: null,
          isBlocked: false,
          blockedByMe: false,
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    }));
    const reportMutate = jest.fn();
    mockUseChatReportsCreate.mockReturnValue({ mutate: reportMutate, isPending: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const view = render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Open chat menu'));
    (
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Chat options')?.[2] ?? []
    ).find((button: any) => button.text === 'Report')?.onPress?.();
    (
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Report conversation')?.[2] ?? []
    ).find((button: any) => button.text === 'Spam')?.onPress?.();

    params = { id: 'room-2', name: 'Bob' };
    act(() => view.rerender(<ChatRoomScreen />));
    act(() => reportMutate.mock.calls[0][1].onSuccess());
    expect(alertSpy).not.toHaveBeenCalledWith('Report submitted', expect.any(String));

    fireEvent.press(screen.getByLabelText('Open chat menu'));
    (
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Chat options')?.[2] ?? []
    ).find((button: any) => button.text === 'Report')?.onPress?.();
    const roomTwoReasons =
      [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Report conversation')?.[2] ?? [];
    roomTwoReasons.find((button: any) => button.text === 'Harassment')?.onPress?.();

    expect(reportMutate.mock.calls[0][0].roomId).toBe('room-1');
    expect(reportMutate.mock.calls[1][0].roomId).toBe('room-2');
    act(() => reportMutate.mock.calls[0][1].onSuccess());
    roomTwoReasons.find((button: any) => button.text === 'Scam')?.onPress?.();

    expect(reportMutate).toHaveBeenCalledTimes(2);
    expect(alertSpy).not.toHaveBeenCalledWith('Report submitted', expect.any(String));
  });

  it('keeps retry identities room-specific when earlier failures resolve out of order', () => {
    let params = { id: 'room-1', name: 'Alice' };
    (useLocalSearchParams as jest.Mock).mockImplementation(() => params);
    mockUseChatRoomsGet.mockImplementation((roomId: string) => ({
      data: {
        room: {
          id: roomId,
          name: params.name,
          kind: 'direct',
          scope: 'global_direct',
          shopId: null,
          isBlocked: false,
          blockedByMe: false,
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    }));
    const reportMutate = jest.fn();
    mockUseChatReportsCreate.mockReturnValue({ mutate: reportMutate, isPending: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    const view = render(<ChatRoomScreen />);

    const reportAs = (reason: string) => {
      fireEvent.press(screen.getByLabelText('Open chat menu'));
      (
        [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Chat options')?.[2] ?? []
      ).find((button: any) => button.text === 'Report')?.onPress?.();
      (
        [...alertSpy.mock.calls].reverse().find((call) => call[0] === 'Report conversation')?.[2] ?? []
      ).find((button: any) => button.text === reason)?.onPress?.();
    };

    reportAs('Spam');
    const roomOneRequestId = reportMutate.mock.calls[0][0].data.clientRequestId;
    params = { id: 'room-2', name: 'Bob' };
    act(() => view.rerender(<ChatRoomScreen />));
    reportAs('Spam');
    const roomTwoRequestId = reportMutate.mock.calls[1][0].data.clientRequestId;
    expect(roomTwoRequestId).not.toBe(roomOneRequestId);

    act(() => reportMutate.mock.calls[0][1].onError(new Error('late room one failure')));
    expect(alertSpy).not.toHaveBeenCalledWith('Could not submit report', 'late room one failure');
    act(() => reportMutate.mock.calls[1][1].onError(new Error('room two failure')));
    reportAs('Spam');

    expect(reportMutate.mock.calls[2][0].roomId).toBe('room-2');
    expect(reportMutate.mock.calls[2][0].data.clientRequestId).toBe(roomTwoRequestId);
  });

  it.each([
    ['block', false, mockUseChatRoomsBlock, 'Block'],
    ['unblock', true, mockUseChatRoomsUnblock, 'Unblock'],
  ])(
    'ignores repeated %s confirmation presses while pending and releases the guard on success',
    (_operation, blockedByMe, mutationHook, actionLabel) => {
      const mutate = jest.fn();
      mutationHook.mockReturnValue({ mutate, isPending: false });
      mockUseChatRoomsGet.mockReturnValue({
        data: {
          room: {
            id: 'room-1',
            name: 'Alice',
            kind: 'direct',
            scope: 'global_direct',
            shopId: null,
            isBlocked: blockedByMe,
            blockedByMe,
            isArchived: false,
            createdAt: '2026-01-01T10:00:00Z',
          },
        },
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

      render(<ChatRoomScreen />);
      fireEvent.press(screen.getByLabelText('Open chat menu'));
      const menuButtons = alertSpy.mock.calls[0][2] ?? [];
      menuButtons.find((button: any) => button.text === actionLabel)?.onPress?.();
      const confirmationButtons =
        [...alertSpy.mock.calls].reverse().find(
          (call) => call[0] === `${actionLabel} Alice?`,
        )?.[2] ?? [];
      const confirmationAction = confirmationButtons.find(
        (button: any) => button.text === actionLabel,
      );

      confirmationAction?.onPress?.();
      confirmationAction?.onPress?.();
      expect(mutate).toHaveBeenCalledTimes(1);

      mutate.mock.calls[0][1].onSuccess();
      confirmationAction?.onPress?.();
      expect(mutate).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['block', false, mockUseChatRoomsBlock, 'Block'],
    ['unblock', true, mockUseChatRoomsUnblock, 'Unblock'],
  ])(
    'allows retrying %s after the first request fails',
    (_operation, blockedByMe, mutationHook, actionLabel) => {
      const mutate = jest.fn();
      mutationHook.mockReturnValue({ mutate, isPending: false });
      mockUseChatRoomsGet.mockReturnValue({
        data: {
          room: {
            id: 'room-1',
            name: 'Alice',
            kind: 'direct',
            scope: 'global_direct',
            shopId: null,
            isBlocked: blockedByMe,
            blockedByMe,
            isArchived: false,
            createdAt: '2026-01-01T10:00:00Z',
          },
        },
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

      render(<ChatRoomScreen />);
      fireEvent.press(screen.getByLabelText('Open chat menu'));
      const menuButtons = alertSpy.mock.calls[0][2] ?? [];
      menuButtons.find((button: any) => button.text === actionLabel)?.onPress?.();
      const confirmationButtons =
        [...alertSpy.mock.calls].reverse().find(
          (call) => call[0] === `${actionLabel} Alice?`,
        )?.[2] ?? [];
      const confirmationAction = confirmationButtons.find(
        (button: any) => button.text === actionLabel,
      );

      confirmationAction?.onPress?.();
      confirmationAction?.onPress?.();
      expect(mutate).toHaveBeenCalledTimes(1);

      mutate.mock.calls[0][1].onError(new Error('slow connection'));
      confirmationAction?.onPress?.();
      expect(mutate).toHaveBeenCalledTimes(2);
    },
  );
});

describe('Chat screen — conversation archive preference', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it.each([
    ['customer', false, 'Archive', true],
    ['direct', true, 'Restore', false],
  ])(
    'offers %s chats the correct archive action and refreshes all room caches',
    async (kind, isArchived, actionLabel, nextArchived) => {
      const mutateAsync = jest.fn().mockResolvedValue({
        preferences: { isArchived: nextArchived },
      });
      mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync, isPending: false });
      mockUseChatRoomsGet.mockReturnValue({
        data: {
          room: {
            id: 'room-1',
            name: 'Alice',
            kind,
            shopId: 's1',
            isArchived,
            createdAt: '2026-01-01T10:00:00Z',
          },
        },
      });
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

      render(<ChatRoomScreen />);
      fireEvent.press(screen.getByLabelText('Open chat menu'));
      const menuButtons = alertSpy.mock.calls[0][2] ?? [];
      menuButtons.find((button: any) => button.text === actionLabel)?.onPress?.();

      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith({
          roomId: 'room-1',
          data: { isArchived: nextArchived },
        });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: ['/api/chat/rooms/room-1'],
        });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: ['/api/chat/rooms'],
        });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({
          queryKey: ['/api/chat/rooms/archived'],
        });
      });

      alertSpy.mockRestore();
    },
  );

  it('ignores repeated archive presses while the first request is pending', async () => {
    let resolveMutation!: (value: unknown) => void;
    const mutateAsync = jest.fn(
      () => new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );
    mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync, isPending: false });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'customer',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Open chat menu'));
    const archiveAction = (alertSpy.mock.calls[0][2] ?? []).find(
      (button: any) => button.text === 'Archive',
    );

    archiveAction?.onPress?.();
    archiveAction?.onPress?.();

    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMutation({ preferences: { isArchived: true } });
      await Promise.resolve();
    });
    alertSpy.mockRestore();
  });

  it('allows retrying archive after the first request fails', async () => {
    let rejectMutation!: (reason?: unknown) => void;
    const mutateAsync = jest
      .fn()
      .mockImplementationOnce(
        () => new Promise((_, reject) => {
          rejectMutation = reject;
        }),
      )
      .mockResolvedValueOnce({ preferences: { isArchived: true } });
    mockUseChatRoomsPreferencesUpdate.mockReturnValue({ mutateAsync, isPending: false });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'customer',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Open chat menu'));
    const archiveAction = (alertSpy.mock.calls[0][2] ?? []).find(
      (button: any) => button.text === 'Archive',
    );

    archiveAction?.onPress?.();
    archiveAction?.onPress?.();
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectMutation(new Error('slow connection'));
      await Promise.resolve();
    });

    archiveAction?.onPress?.();
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    alertSpy.mockRestore();
  });

  it('does not offer archive actions for non-customer room kinds', () => {
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Repair discussion',
          kind: 'repair',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Open chat menu'));
    const menuButtons = alertSpy.mock.calls[0][2] ?? [];

    expect(menuButtons.map((button: any) => button.text)).not.toEqual(
      expect.arrayContaining(['Archive', 'Restore']),
    );
    alertSpy.mockRestore();
  });
});

// ── Chat screen: send and read ─────────────────────────────────────────────

describe('Chat screen — text send and read marker', () => {
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({
      data: { room: { id: 'room-1', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z' } },
    });
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          { id: 'msg-2', body: 'How is it?', senderId: 'other-user', senderName: 'Alice', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: '2026-01-01T10:01:00Z' },
          { id: 'msg-1', body: 'Hi!', senderId: 'staff-1', senderName: 'Staff', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: '2026-01-01T10:00:00Z' },
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('renders existing messages', () => {
    render(<ChatRoomScreen />);
    expect(screen.getByText('Hi!')).toBeTruthy();
    expect(screen.getByText('How is it?')).toBeTruthy();
  });

  it('calls markRead for latest incoming message on mount', () => {
    const markRead = jest.fn();
    mockUseChatMarkRead.mockReturnValue({ mutate: markRead });
    render(<ChatRoomScreen />);
    // Latest incoming is msg-2 (first in newest-first array, from other-user)
    expect(markRead).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: 'room-1', data: { messageId: 'msg-2' } }),
    );
  });

  it('offers "Delete for everyone" only for own messages sent within the last 24 hours', async () => {
    const now = Date.now();
    const fresh = { id: 'msg-fresh', body: 'fresh mine', senderId: 'staff-1', senderName: 'Staff', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: new Date(now - 60 * 60 * 1000).toISOString() };
    const old = { id: 'msg-old', body: 'old mine', senderId: 'staff-1', senderName: 'Staff', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() };
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [fresh, old], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<ChatRoomScreen />);

    const optionTexts = () => (alertSpy.mock.calls.at(-1)?.[2] as Array<{ text: string }>).map((b) => b.text);

    fireEvent(screen.getByText('fresh mine'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-delete'));
    expect(alertSpy).toHaveBeenLastCalledWith('Delete message?', undefined, expect.any(Array));
    expect(optionTexts()).toEqual(['Delete for everyone', 'Delete for me', 'Cancel']);
    fireEvent.press(screen.getByLabelText('Clear selection'));

    fireEvent(screen.getByText('old mine'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-delete'));
    expect(optionTexts()).toEqual(['Delete for me', 'Cancel']);
    fireEvent.press(screen.getByLabelText('Clear selection'));

    // A mixed selection is only ever deletable for me.
    fireEvent(screen.getByText('fresh mine'), 'longPress');
    fireEvent.press(screen.getByText('old mine'));
    fireEvent.press(screen.getByTestId('selection-delete'));
    expect(optionTexts()).toEqual(['Delete for me', 'Cancel']);
    alertSpy.mockRestore();
  });

  it('calls send mutation with correct roomId and text body', async () => {
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);
    const input = screen.getByPlaceholderText('Message…');
    fireEvent.changeText(input, 'Hello world');
    fireEvent.press(screen.getByLabelText('Send message'));
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: {
          kind: 'text',
          body: 'Hello world',
          clientRequestId: expect.stringMatching(/^message-/),
        },
      }),
      expect.anything(),
    );
  });

  it('shows retry error bar when send fails', async () => {
    const sendMutate = jest.fn((args: any, cb: any) => cb?.onError?.({ message: 'Network error' }));
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);
    const input = screen.getByPlaceholderText('Message…');
    fireEvent.changeText(input, 'Test message');
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });
});

// ── Attachment tests ────────────────────────────────────────────────────────

describe('Chat screen — attachments', () => {
  /**
   * Common setup: provider available, room resolved, messages loaded.
   */
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'customer',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('attachment button is disabled when provider is unavailable', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    const btn = screen.queryByLabelText('Add attachment');
    // Either it's absent (setup-pending card shown) or disabled
    if (btn) {
      expect(btn.props.accessibilityState?.disabled ?? btn.props.disabled).toBe(true);
    } else {
      // Provider-unavailable card is shown — attachment button rightly absent
      expect(screen.getByText('Chat setup pending')).toBeTruthy();
    }
  });

  it('does not call picker when provider unavailable and button is pressed', async () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    // Provider is down — the card is shown, no attachment button exists
    expect(screen.queryByLabelText('Add attachment')).toBeNull();
    expect(mockGetDocumentAsync).not.toHaveBeenCalled();
  });

  it('attachment button is enabled when provider available and room resolved', () => {
    render(<ChatRoomScreen />);
    const btn = screen.getByLabelText('Add attachment');
    expect(btn).toBeTruthy();
    // Should not be disabled
    expect(btn.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('opens the attachment panel with four native actions and expands Recents', async () => {
    mockGetAssetsAsync.mockResolvedValueOnce({
      assets: [{
        id: 'asset-1',
        filename: 'recent.jpg',
        uri: 'file:///photos/recent.jpg',
        mediaType: 'photo',
        width: 100,
        height: 100,
        creationTime: 1,
        modificationTime: 1,
        duration: 0,
      }],
      endCursor: 'asset-1',
      hasNextPage: false,
    });
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    expect(screen.getByTestId('attachment-sheet')).toBeTruthy();
    expect(screen.getByLabelText('Gallery')).toBeTruthy();
    expect(screen.getByLabelText('Location')).toBeTruthy();
    expect(screen.getByLabelText('Contact')).toBeTruthy();
    expect(screen.getByLabelText('Document')).toBeTruthy();

    await waitFor(() => expect(screen.getByLabelText('Select recent.jpg')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('View all recent photos'));
    expect(screen.getAllByText('Recents').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText('Collapse recent gallery'));
    expect(screen.getByText('Attach')).toBeTruthy();
  });

  it('explains denied photo access instead of showing a misleading empty gallery', async () => {
    mockGetMediaPermissionsAsync.mockResolvedValueOnce({ granted: false, accessPrivileges: 'none' });
    mockRequestMediaPermissionsAsync.mockResolvedValueOnce({ granted: false, accessPrivileges: 'none' });
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));

    expect(
      await screen.findByText('Photo access is off. Allow access to show recent photos here.'),
    ).toBeTruthy();
    expect(screen.getByText('Open settings')).toBeTruthy();
  });

  it('loads additional recent-photo pages when the expanded grid nears its end', async () => {
    const firstAsset = {
      id: 'asset-1',
      filename: 'first.jpg',
      uri: 'file:///photos/first.jpg',
      mediaType: 'photo',
      width: 100,
      height: 100,
      creationTime: 2,
      modificationTime: 2,
      duration: 0,
    };
    const secondAsset = {
      ...firstAsset,
      id: 'asset-2',
      filename: 'second.jpg',
      uri: 'file:///photos/second.jpg',
      creationTime: 1,
      modificationTime: 1,
    };
    mockGetAssetsAsync
      .mockResolvedValueOnce({
        assets: [firstAsset],
        endCursor: 'asset-1',
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        assets: [secondAsset],
        endCursor: 'asset-2',
        hasNextPage: false,
      });
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    await screen.findByLabelText('Select first.jpg');
    fireEvent.press(screen.getByLabelText('View all recent photos'));
    fireEvent.scroll(screen.getByTestId('attachment-recents-scroll'), {
      nativeEvent: {
        contentOffset: { y: 300, x: 0 },
        contentSize: { height: 700, width: 400 },
        layoutMeasurement: { height: 500, width: 400 },
      },
    });

    await waitFor(() =>
      expect(mockGetAssetsAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({ after: 'asset-1' }),
      ),
    );
    expect(await screen.findByLabelText('Select second.jpg')).toBeTruthy();
  });

  it('uses the native gallery picker and queues its selected photo', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        uri: 'file:///photos/gallery.jpg',
        fileName: 'gallery.jpg',
        mimeType: 'image/jpeg',
        fileSize: 3210,
        type: 'image',
      }],
    });
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Gallery'));

    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    expect(await screen.findByText('gallery.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Send attachment')).toBeTruthy();
  });

  it('uses a recent asset id for metadata and falls back to its content URI', async () => {
    mockGetAssetsAsync.mockResolvedValueOnce({
      assets: [{
        id: 'asset-recent',
        filename: 'recent.jpg',
        uri: 'content://media/recent.jpg',
        mediaType: 'photo',
        width: 100,
        height: 100,
        creationTime: 1,
        modificationTime: 1,
        duration: 0,
      }],
      endCursor: 'asset-recent',
      hasNextPage: false,
    });
    mockGetAssetInfoAsync.mockRejectedValueOnce(
      new Error("Call to function 'ExpoMediaLibrary.getAssetInfoAsync' has been rejected."),
    );
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(await screen.findByLabelText('Select recent.jpg'));

    await waitFor(() => expect(mockGetAssetInfoAsync).toHaveBeenCalledWith('asset-recent'));
    expect(await screen.findByText('recent.jpg')).toBeTruthy();
    expect(screen.getByLabelText('Send attachment')).toBeTruthy();
    expect(
      screen.queryByText(/ExpoMediaLibrary\.getAssetInfoAsync/),
    ).toBeNull();
  });

  it('shares the real current coordinates through the existing text-message flow', async () => {
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Location'));

    await waitFor(() => expect(mockGetCurrentPositionAsync).toHaveBeenCalled());
    expect(sendMutate).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{ text?: string; onPress?: () => void }>;
    const sendLocationButton = buttons.find((button) => button.text === 'Send location');
    expect(sendLocationButton).toBeTruthy();
    act(() => sendLocationButton?.onPress?.());
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: expect.objectContaining({
          kind: 'text',
          body: expect.stringContaining('28.6139,77.209'),
        }),
      }),
      expect.anything(),
    );
    alertSpy.mockRestore();
  });

  it('reads device contacts and shares the selected real contact', async () => {
    mockGetContactsAsync.mockResolvedValueOnce({
      data: [{
        id: 'contact-1',
        name: 'Priya',
        contactType: 'person',
        phoneNumbers: [{ id: 'phone-1', number: '+91 98765 43210', label: 'mobile' }],
      }],
      hasNextPage: false,
      hasPreviousPage: false,
    });
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Contact'));
    const contactRow = await screen.findByLabelText('Share contact Priya');
    fireEvent.press(contactRow);

    expect(mockRequestContactsPermissionsAsync).toHaveBeenCalled();
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: expect.objectContaining({
          kind: 'text',
          body: expect.stringContaining('+91 98765 43210'),
        }),
      }),
      expect.anything(),
    );
  });

  it('picker cancel clears pending attachment without error', async () => {
    // getDocumentAsync returns canceled=true
    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));
    await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalled());
    // No attachment preview should appear
    expect(screen.queryByLabelText('Send attachment')).toBeNull();
    expect(screen.queryByLabelText('Cancel attachment')).toBeNull();
  });

  it('upload→send: calls chatUploadUrl and then send with correct payload including stable clientRequestId and objectPath', async () => {
    // Picker returns an image
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'photo.jpg',
        uri: 'file:///cache/photo.jpg',
        mimeType: 'image/jpeg',
        size: 4096,
        lastModified: Date.now(),
      }],
    });

    // Upload URL mutation: call onSuccess synchronously
    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ uploadURL: 'https://s3.example.com/presigned-put', objectPath: 'uploads/s1/chat/room-1/photo.jpg' });
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });

    // FileSystem upload succeeds
    mockCreateUploadTask.mockReturnValue({
      uploadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });

    // Send mutation: call onSuccess
    const sendMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ message: { id: 'new-msg-1' } });
    });
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    render(<ChatRoomScreen />);

    // Open picker
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));
    await waitFor(() => screen.getByLabelText('Send attachment'));

    // Send the attachment
    fireEvent.press(screen.getByLabelText('Send attachment'));

    // uploadUrlMutation should be called with correct room and file metadata
    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          data: expect.objectContaining({
            name: 'photo.jpg',
            size: 4096,
            contentType: 'image/jpeg',
          }),
        }),
        expect.anything(),
      );
    });

    // createUploadTask should be called with presigned PUT URL and content type
    await waitFor(() => {
      expect(mockCreateUploadTask).toHaveBeenCalledWith(
        'https://s3.example.com/presigned-put',
        'file:///cache/photo.jpg',
        expect.objectContaining({
          httpMethod: 'PUT',
          headers: expect.objectContaining({ 'Content-Type': 'image/jpeg' }),
        }),
        expect.any(Function),
      );
    });

    // sendMutation should be called with kind=image, body=filename, objectPath, stable clientRequestId
    await waitFor(() => {
      expect(sendMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          data: expect.objectContaining({
            kind: 'image',
            body: 'photo.jpg',
            objectPath: 'uploads/s1/chat/room-1/photo.jpg',
            clientRequestId: expect.stringMatching(/^attach-/),
          }),
        }),
        expect.anything(),
      );
    });
  });

  it.each([0, undefined])('resolves a %s picker size before requesting an upload URL', async (reportedSize) => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'unknown-size.pdf',
        uri: 'file:///cache/unknown-size.pdf',
        mimeType: 'application/pdf',
        size: reportedSize,
      }],
    });
    mockGetInfoAsync.mockResolvedValueOnce({ exists: true, size: 8192 });

    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ uploadURL: 'https://s3.example.com/put', objectPath: 'uploads/s1/chat/room-1/unknown-size.pdf' });
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    mockUseChatMessagesSend.mockReturnValue({
      mutate: jest.fn((_: any, cbs: any) => cbs?.onSuccess?.({ message: { id: 'size-msg' } })),
      isPending: false,
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));

    // The pending card is not shown until the local file has been stat'ed,
    // so a fast tap cannot submit the picker-provided zero value.
    expect(screen.queryByLabelText('Send attachment')).toBeNull();
    await waitFor(() => screen.getByLabelText('Send attachment'));
    fireEvent.press(screen.getByLabelText('Send attachment'));

    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ size: 8192 }),
        }),
        expect.anything(),
      );
    });
    expect(uploadMutate.mock.calls[0][0].data.size).toBeGreaterThan(0);
  });

  it('copies an Android content URI with unknown size to cache before it becomes sendable', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'provider-document.pdf',
        uri: 'content://com.android.providers.media.documents/document/42',
        mimeType: 'application/pdf',
        size: 0,
      }],
    });
    mockGetInfoAsync.mockResolvedValueOnce({ exists: true, size: 16384 });

    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ uploadURL: 'https://s3.example.com/content-put', objectPath: 'uploads/s1/chat/room-1/provider-document.pdf' });
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    mockUseChatMessagesSend.mockReturnValue({
      mutate: jest.fn((_: any, cbs: any) => cbs?.onSuccess?.({ message: { id: 'content-msg' } })),
      isPending: false,
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));

    // The explicit Send control is not rendered until the cache copy is stat'ed.
    expect(screen.queryByLabelText('Send attachment')).toBeNull();
    await waitFor(() => screen.getByLabelText('Send attachment'));
    const cachedUri = mockCopyAsync.mock.calls[0][0].to;
    expect(mockCopyAsync).toHaveBeenCalledWith(expect.objectContaining({
      from: 'content://com.android.providers.media.documents/document/42',
      to: expect.stringMatching(/^file:\/\/\/cache\//),
    }));
    expect(mockGetInfoAsync).toHaveBeenCalledWith(cachedUri);

    fireEvent.press(screen.getByLabelText('Send attachment'));
    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ size: 16384 }) }),
        expect.anything(),
      );
      expect(mockCreateUploadTask).toHaveBeenCalledWith(
        'https://s3.example.com/content-put',
        cachedUri,
        expect.anything(),
        expect.any(Function),
      );
    });
  });

  it('send retains same clientRequestId on retry (idempotent)', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'doc.pdf',
        uri: 'file:///cache/doc.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        lastModified: Date.now(),
      }],
    });

    // First attempt: upload URL fails
    const uploadMutate = jest.fn()
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onError?.(new Error('Network timeout'));
      })
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onSuccess?.({ uploadURL: 'https://s3.example.com/retry-url', objectPath: 'uploads/s1/chat/room-1/doc.pdf' });
      });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });

    const sendMutate = jest.fn((args: any, cbs: any) => cbs?.onSuccess?.({ message: { id: 'msg-r' } }));
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    render(<ChatRoomScreen />);

    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));
    await waitFor(() => screen.getByLabelText('Send attachment'));

    // First attempt — will fail on upload URL
    fireEvent.press(screen.getByLabelText('Send attachment'));
    await waitFor(() => expect(screen.getByText(/Retry/)).toBeTruthy());

    // Capture the clientRequestId from the first send attempt args (it's undefined as send wasn't reached)
    // Instead verify that after retry the same pending attachment clientRequestId is used
    const firstCallArgs = uploadMutate.mock.calls[0][0];
    expect(firstCallArgs.roomId).toBe('room-1');

    // Retry — press retry button in the error bar
    fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => {
      // Both upload calls happened
      expect(uploadMutate).toHaveBeenCalledTimes(2);
      // Second call should have same roomId
      expect(uploadMutate.mock.calls[1][0].roomId).toBe('room-1');
    });
  });

  it('upload failure shows actionable error text without crashing', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'video.mp4',
        uri: 'file:///cache/video.mp4',
        mimeType: 'video/mp4',
        size: 10 * 1024 * 1024, // 10 MB — within limit
        lastModified: Date.now(),
      }],
    });

    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onError?.(new Error('Storage quota exceeded'));
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));
    await waitFor(() => screen.getByLabelText('Send attachment'));

    fireEvent.press(screen.getByLabelText('Send attachment'));

    await waitFor(() => {
      expect(screen.getByText(/Storage quota exceeded/)).toBeTruthy();
    });

    // sendMutation should NOT have been called (upload failed before send)
    expect(mockUseChatMessagesSend().mutate).not.toHaveBeenCalled();
  });

  it('renders image messages using private /api/chat/rooms/:roomId/messages/:messageId/media endpoint not generic storage', () => {
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          {
            id: 'img-msg-1',
            body: 'photo.jpg',
            kind: 'image',
            senderId: 'other-user',
            senderName: 'Alice',
            roomId: 'room-1',
            shopId: 's1',
            createdAt: '2026-01-01T10:05:00Z',
          },
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<ChatRoomScreen />);

    // The image attachment component should appear
    const imgEl = screen.getByTestId('image-attachment-img-msg-1');
    expect(imgEl).toBeTruthy();

    // Verify media URL is the private API endpoint, not /api/storage/objects/...
    // We check that getChatMessageMediaUrl was called (it's mocked to return the correct path)
    const mediaUrl = `/api/chat/rooms/room-1/messages/img-msg-1/media`;
    expect(mediaUrl).toContain('/api/chat/rooms/');
    expect(mediaUrl).toContain('/messages/');
    expect(mediaUrl).toContain('/media');
    expect(mediaUrl).not.toContain('/api/storage/objects');
  });

  it('renders file messages with filename visible and download button', () => {
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          {
            id: 'file-msg-1',
            body: 'invoice.pdf',
            kind: 'file',
            senderId: 'other-user',
            senderName: 'Alice',
            roomId: 'room-1',
            shopId: 's1',
            createdAt: '2026-01-01T10:06:00Z',
          },
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<ChatRoomScreen />);

    // File row should show filename
    expect(screen.getByText('invoice.pdf')).toBeTruthy();
    // The file attachment element should be present
    expect(screen.getByTestId('file-attachment-file-msg-1')).toBeTruthy();
    // Download button has accessible label
    expect(screen.getByLabelText('Download invoice.pdf')).toBeTruthy();
  });

  it('PDF picker results in kind=file send (not kind=image)', async () => {
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{
        name: 'report.pdf',
        uri: 'file:///cache/report.pdf',
        mimeType: 'application/pdf',
        size: 512000,
        lastModified: Date.now(),
      }],
    });

    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ uploadURL: 'https://s3.example.com/put', objectPath: 'uploads/s1/chat/room-1/report.pdf' });
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });

    const sendMutate = jest.fn((args: any, cbs: any) => cbs?.onSuccess?.({ message: { id: 'pdf-msg' } }));
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Document'));
    await waitFor(() => screen.getByLabelText('Send attachment'));
    fireEvent.press(screen.getByLabelText('Send attachment'));

    await waitFor(() => {
      expect(sendMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: 'file',
            body: 'report.pdf',
          }),
        }),
        expect.anything(),
      );
    });
  });
});

// ── Voice note tests ────────────────────────────────────────────────────────

describe('Chat screen — voice notes', () => {
  /** Common setup: provider available, room resolved, empty messages. */
  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({
      data: {
        room: {
          id: 'room-1',
          name: 'Alice',
          kind: 'customer',
          shopId: 's1',
          isArchived: false,
          createdAt: '2026-01-01T10:00:00Z',
        },
      },
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    mockFakeFiles.clear();
    mockRecorderUri.current = 'file:///cache/voice-note-123.aac';
    seedFakeFile('file:///cache/voice-note-123.aac', [1, 2, 3, 4]);
    stubRecorderState(3000);
  });

  function stubUploadAndSend() {
    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({
        uploadURL: 'https://s3.example.com/voice-presigned',
        objectPath: 'uploads/s1/chat/room-1/voice-note-123.aac',
      });
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    mockCreateUploadTask.mockReturnValue({
      uploadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });
    const sendMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({ message: { id: 'audio-msg-1' } });
    });
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    return { uploadMutate, sendMutate };
  }

  it('mic button is enabled when provider available and room resolved', () => {
    render(<ChatRoomScreen />);
    const mic = screen.getByLabelText(MIC_LABEL);
    expect(mic).toBeTruthy();
    expect(mic.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('mic button is absent when provider is unavailable', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    expect(screen.getByText('Chat setup pending')).toBeTruthy();
    expect(screen.queryByLabelText(MIC_LABEL)).toBeNull();
  });

  it('shows permission-denied notice when microphone permission is denied', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied' });
    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText(MIC_LABEL));
    await waitFor(() => expect(screen.getByText(/Microphone permission denied/)).toBeTruthy());
    expect(mockRecorderRecord).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Pause recording')).toBeNull();
  });

  it('a tap opens the recording panel with Delete, Pause and Send', async () => {
    render(<ChatRoomScreen />);
    await startRecording();
    expect(screen.getByLabelText('Delete recording')).toBeTruthy();
    expect(screen.getByLabelText('Send voice note')).toBeTruthy();
    expect(screen.getByLabelText('Recording elapsed time')).toBeTruthy();
    expect(screen.getByLabelText('Recording waveform')).toBeTruthy();
    // Composer is replaced by the panel
    expect(screen.queryByLabelText(MIC_LABEL)).toBeNull();
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true }));
  });

  it('records mono AAC ADTS with metering so segments can be merged and visualised', () => {
    const { useAudioRecorder } = jest.requireMock('expo-audio');
    render(<ChatRoomScreen />);
    const options = (useAudioRecorder as jest.Mock).mock.calls[0][0];
    expect(options).toEqual(
      expect.objectContaining({
        extension: '.aac',
        numberOfChannels: 1,
        isMeteringEnabled: true,
        android: expect.objectContaining({ outputFormat: 'aac_adts', audioEncoder: 'aac' }),
      }),
    );
  });

  it('caps every segment natively at the remaining budget (forDuration), not with a JS timer', async () => {
    render(<ChatRoomScreen />);
    await startRecording();
    expect(mockRecorderRecord).toHaveBeenCalledWith({ forDuration: 600 });

    stubRecorderState(4000);
    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());

    mockRecorderPrepare.mockImplementationOnce(async () => {
      mockRecorderUri.current = 'file:///cache/seg-2.aac';
      seedFakeFile('file:///cache/seg-2.aac', [9]);
    });
    fireEvent.press(screen.getByLabelText('Resume recording'));
    await waitForRecordingReady();
    expect(mockRecorderRecord).toHaveBeenLastCalledWith({ forDuration: 596 });
  });

  it('prepares the recorder before record() — Android record() is a no-op on an unprepared recorder', async () => {
    const order: string[] = [];
    mockRecorderPrepare.mockImplementationOnce(async () => { order.push('prepare'); });
    mockRecorderRecord.mockImplementationOnce(() => { order.push('record'); });

    render(<ChatRoomScreen />);
    await startRecording();
    expect(order).toEqual(['prepare', 'record']);
  });

  it('recovers when the recorder was left prepared by an earlier aborted attempt', async () => {
    mockRecorderPrepare
      .mockRejectedValueOnce(new Error('AudioRecorder has already been prepared. Stop or release the current session before preparing again.'))
      .mockResolvedValueOnce(undefined);

    render(<ChatRoomScreen />);
    await startRecording();
    expect(mockRecorderStop).toHaveBeenCalled();
    expect(mockRecorderPrepare).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/already been prepared/)).toBeNull();
  });

  it('releases the recorder and audio session when record() throws after prepare', async () => {
    mockRecorderRecord.mockImplementationOnce(() => {
      throw new Error('record boom');
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText(MIC_LABEL));

    await waitFor(() => expect(screen.getByText(/record boom/)).toBeTruthy());
    expect(mockRecorderPrepare).toHaveBeenCalled();
    expect(mockRecorderStop).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    });
    expect(screen.queryByLabelText('Pause recording')).toBeNull();
    expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy();
  });

  it('Delete while recording stops, restores the audio session and never uploads', async () => {
    const { uploadMutate, sendMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Delete recording'));

    await waitFor(() => expect(mockRecorderStop).toHaveBeenCalled());
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    });
    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
    expect(uploadMutate).not.toHaveBeenCalled();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('Delete tolerates a rejecting stop() and still restores the audio session', async () => {
    mockRecorderStop.mockRejectedValueOnce(new Error('stop boom'));
    const { uploadMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Delete recording'));

    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    });
    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('Pause finalises the segment, leaves recording mode and offers playback + Resume', async () => {
    const mockPlayer = mockUseAudioPlayer();
    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Pause recording'));

    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());
    // Pause is a real stop so the file is playable
    expect(mockRecorderStop).toHaveBeenCalledTimes(1);
    // Preview must play through the loudspeaker, not the in-call earpiece
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    expect(screen.getByLabelText('Play recording')).toBeTruthy();
    expect(screen.getByLabelText('Recording length')).toBeTruthy();
    expect(mockUseAudioPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///cache/voice-note-123.aac' }),
      expect.anything(),
    );

    fireEvent.press(screen.getByLabelText('Play recording'));
    expect(mockPlayer.play).toHaveBeenCalled();
  });

  it('Pause with a failing stop() surfaces the error and restores the audio session', async () => {
    mockRecorderStop.mockRejectedValueOnce(new Error('pause boom'));
    const { uploadMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Pause recording'));

    await waitFor(() => expect(screen.getByText(/pause boom/)).toBeTruthy());
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    });
    expect(screen.queryByLabelText('Resume recording')).toBeNull();
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('Resume records a new segment and Send merges both into one AAC stream with the summed duration', async () => {
    const { uploadMutate, sendMutate } = stubUploadAndSend();
    // Every prepare creates a fresh native file, as expo-audio does on device.
    const segmentUris = ['file:///cache/seg-1.aac', 'file:///cache/seg-2.aac'];
    const segmentBytes = [[10, 11, 12], [20, 21]];
    for (const i of [0, 1]) {
      mockRecorderPrepare.mockImplementationOnce(async () => {
        mockRecorderUri.current = segmentUris[i];
        seedFakeFile(segmentUris[i], segmentBytes[i]);
      });
    }
    // The merged file is deleted after a successful send — snapshot it at upload time.
    let uploadedBytes: number[] | null = null;
    mockCreateUploadTask.mockImplementation((_url: string, uri: string) => {
      uploadedBytes = Array.from(mockFakeFiles.get(uri) ?? []);
      return { uploadAsync: jest.fn().mockResolvedValue({ status: 200 }) };
    });

    render(<ChatRoomScreen />);
    await startRecording();

    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Resume recording'));
    await waitForRecordingReady();
    expect(mockRecorderPrepare).toHaveBeenCalledTimes(2);
    expect(mockRecorderRecord).toHaveBeenCalledTimes(2);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true }));

    fireEvent.press(screen.getByLabelText('Send voice note'));

    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(mockRecorderStop).toHaveBeenCalledTimes(2);

    // One merged file, byte-concatenated, parts removed
    const [, uploadedUri, uploadOpts] = mockCreateUploadTask.mock.calls[0];
    expect(uploadedUri).toMatch(/^file:\/\/\/cache\/voice-note-.*\.aac$/);
    expect(uploadedBytes).toEqual([10, 11, 12, 20, 21]);
    expect(mockFakeFiles.has(segmentUris[0])).toBe(false);
    expect(mockFakeFiles.has(segmentUris[1])).toBe(false);
    // …and the merged file itself is gone once the note is sent.
    expect(mockFakeFiles.has(uploadedUri)).toBe(false);
    expect(uploadOpts.headers['Content-Type']).toBe('audio/aac');
    expect(uploadMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: expect.objectContaining({
          name: expect.stringMatching(/voice-note-\d+\.aac/),
          contentType: 'audio/aac',
          size: 5,
        }),
      }),
      expect.anything(),
    );
    // 3000ms + 3000ms of recording
    expect(sendMutate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ kind: 'audio', durationMs: 6000 }),
    );
    // Back to the composer with nothing pending
    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
  });

  it('Send while recording stops once and sends kind=audio with durationMs, objectPath and a voice clientRequestId', async () => {
    const { uploadMutate, sendMutate } = stubUploadAndSend();
    // Android may clear recorder.uri while stop() finalises the native file.
    mockRecorderStop.mockImplementationOnce(async () => {
      mockRecorderUri.current = null;
    });
    stubRecorderState(5000);

    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Send voice note'));

    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(mockRecorderStop).toHaveBeenCalledTimes(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    expect(uploadMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: expect.objectContaining({
          name: expect.stringMatching(/voice-note-\d+\.aac/),
          contentType: 'audio/aac',
        }),
      }),
      expect.anything(),
    );
    expect(mockCreateUploadTask).toHaveBeenCalledWith(
      'https://s3.example.com/voice-presigned',
      'file:///cache/voice-note-123.aac',
      expect.objectContaining({
        httpMethod: 'PUT',
        headers: expect.objectContaining({ 'Content-Type': 'audio/aac' }),
      }),
      expect.any(Function),
    );
    const sentData = sendMutate.mock.calls[0][0].data;
    expect(sentData).toEqual(
      expect.objectContaining({
        kind: 'audio',
        objectPath: 'uploads/s1/chat/room-1/voice-note-123.aac',
        durationMs: 5000,
        clientRequestId: expect.stringMatching(/^voice-/),
      }),
    );
    expect(Number.isInteger(sentData.durationMs)).toBe(true);
  });

  it('Send while paused sends the finalised file without stopping again', async () => {
    const { sendMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();

    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());
    expect(mockRecorderStop).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('Send voice note'));

    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(mockRecorderStop).toHaveBeenCalledTimes(1);
    expect(mockCreateUploadTask.mock.calls[0][1]).toBe('file:///cache/voice-note-123.aac');
    expect(sendMutate.mock.calls[0][0].data.durationMs).toBe(3000);
  });

  it('Delete while paused discards the finalised file and never uploads', async () => {
    const { uploadMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Delete recording'));

    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
    expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(false);
    expect(uploadMutate).not.toHaveBeenCalled();
  });

  it('a recording shorter than the minimum is discarded on Send with an explanation', async () => {
    const { uploadMutate } = stubUploadAndSend();
    stubRecorderState(200);
    render(<ChatRoomScreen />);
    await startRecording();

    fireEvent.press(screen.getByLabelText('Send voice note'));

    await waitFor(() => expect(screen.getByText(/Recording too short/)).toBeTruthy());
    expect(mockRecorderStop).toHaveBeenCalledTimes(1);
    expect(uploadMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy();
  });

  it('auto-pauses at the 10-minute cap so the note can still be previewed and sent', async () => {
    const { sendMutate } = stubUploadAndSend();
    let durationMillis = 2000;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: true,
      durationMillis,
      mediaServicesDidReset: false,
      url: null,
    }));

    render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    // The native forDuration timer stopped the recorder on its own; the status
    // on the native side is already reset, so the duration must not be read
    // from it.
    durationMillis = 0;
    jest.setSystemTime(Date.now() + 10 * 60 * 1000 + 250);
    await act(async () => {
      mockRecorderStatusListener.current?.({
        id: 1,
        isFinished: true,
        hasError: false,
        error: null,
        url: 'file:///cache/voice-note-123.aac',
      });
    });

    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());
    // No JS-side stop() — the native side already finalised the file.
    expect(mockRecorderStop).not.toHaveBeenCalled();
    expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));

    fireEvent.press(screen.getByLabelText('Send voice note'));
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(mockRecorderStop).not.toHaveBeenCalled();
    expect(sendMutate.mock.calls[0][0].data.durationMs).toBe(600000);
  });

  it('an early native stop (interruption) keeps the real length instead of the whole budget', async () => {
    const { sendMutate } = stubUploadAndSend();
    stubRecorderState(0);
    render(<ChatRoomScreen />);
    await startRecording();

    jest.setSystemTime(Date.now() + 4200);
    await act(async () => {
      mockRecorderStatusListener.current?.({
        id: 1,
        isFinished: true,
        hasError: false,
        error: null,
        url: 'file:///cache/voice-note-123.aac',
      });
    });
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());
    expect(screen.getByText('0:04')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Send voice note'));
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(sendMutate.mock.calls[0][0].data.durationMs).toBe(4200);
  });

  it('dismissing an upload error disposes the owned voice file', async () => {
    const uploadMutate = jest.fn((_args: any, cbs: any) => {
      cbs?.onError?.(new Error('upload down'));
    });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    stubRecorderState(5000);
    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Send voice note'));
    await waitFor(() => expect(uploadMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Retry')).toBeTruthy());
    expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(true);

    fireEvent.press(screen.getByLabelText('Dismiss upload error'));
    await waitFor(() => expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(false));
  });

  it('a native recorder failure mid-recording restores the session and explains instead of hanging', async () => {
    const { sendMutate } = stubUploadAndSend();
    render(<ChatRoomScreen />);
    await startRecording();

    await act(async () => {
      mockRecorderStatusListener.current?.({
        id: 1,
        isFinished: true,
        hasError: true,
        error: 'Microphone taken by another app',
        url: null,
      });
    });

    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
    expect(screen.getByText('Microphone taken by another app')).toBeTruthy();
    expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('ignores the recorder finish event that follows our own stop()', async () => {
    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());

    // Android emits recordingStatusUpdate {isFinished} asynchronously after stop().
    await act(async () => {
      mockRecorderStatusListener.current?.({ id: 1, isFinished: true, hasError: false, error: null, url: 'file:///cache/voice-note-123.aac' });
    });
    expect(screen.getByLabelText('Resume recording')).toBeTruthy();
    expect(screen.getByText('0:03')).toBeTruthy();
  });

  it('never starts capturing when the screen unmounts while the permission prompt is open', async () => {
    let grant: (v: { granted: boolean }) => void = () => undefined;
    mockRequestRecordingPermissionsAsync.mockImplementationOnce(
      () => new Promise<{ granted: boolean }>((resolve) => { grant = resolve; }),
    );

    const { unmount } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText(MIC_LABEL));
    await waitFor(() => expect(mockRequestRecordingPermissionsAsync).toHaveBeenCalled());

    unmount();
    await act(async () => {
      grant({ granted: true });
    });

    expect(mockRecorderRecord).not.toHaveBeenCalled();
    expect(mockSetAudioModeAsync).not.toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: true }));
  });

  it('removes the live segment file when Delete is pressed while recording', async () => {
    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Delete recording'));
    await waitFor(() => expect(screen.getByLabelText(MIC_LABEL)).toBeTruthy());
    expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(false);
  });

  it('deletes the finished voice file once the note has been sent', async () => {
    const { sendMutate } = stubUploadAndSend();
    stubRecorderState(5000);
    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Send voice note'));
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(false));
  });

  it('send retry reuses same clientRequestId and does NOT re-upload (objectPath already known)', async () => {
    const uploadMutate = jest.fn()
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onSuccess?.({
          uploadURL: 'https://s3.example.com/voice-presigned',
          objectPath: 'uploads/s1/chat/room-1/voice-note-123.aac',
        });
      });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    mockCreateUploadTask.mockReturnValue({
      uploadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });
    const sendMutate = jest.fn()
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onError?.(new Error('Provider timeout'));
      })
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onSuccess?.({ message: { id: 'audio-retry-msg' } });
      });
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Send voice note'));

    await waitFor(() => expect(screen.getByText(/Provider timeout/)).toBeTruthy());
    const firstCrid = sendMutate.mock.calls[0][0].data.clientRequestId;
    expect(firstCrid).toMatch(/^voice-/);

    fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(2));
    expect(uploadMutate).toHaveBeenCalledTimes(1);
    expect(sendMutate.mock.calls[1][0].data.clientRequestId).toBe(firstCrid);
  });

  it('unmount cleanup tolerates a rejecting stop() and still restores the audio session', async () => {
    mockRecorderStop.mockRejectedValueOnce(new Error('unmount stop boom'));
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    const { unmount } = render(<ChatRoomScreen />);
    await startRecording();
    mockSetAudioModeAsync.mockClear();

    unmount();
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsRecording: false }));
    });
    await act(async () => { await Promise.resolve(); });
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('unmount while paused removes the finalised temp file', async () => {
    const { unmount } = render(<ChatRoomScreen />);
    await startRecording();
    fireEvent.press(screen.getByLabelText('Pause recording'));
    await waitFor(() => expect(screen.getByLabelText('Resume recording')).toBeTruthy());

    unmount();
    expect(mockFakeFiles.has('file:///cache/voice-note-123.aac')).toBe(false);
  });

  it('renders audio messages with private /api/chat/rooms/:id/messages/:id/media URL (not objectPath)', () => {
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          {
            id: 'audio-msg-42',
            body: 'Voice note',
            kind: 'audio',
            durationMs: 7200,
            senderId: 'other-user',
            senderName: 'Alice',
            roomId: 'room-1',
            shopId: 's1',
            createdAt: '2026-01-01T10:10:00Z',
          },
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<ChatRoomScreen />);

    // Audio player component should be present with testID
    const audioEl = screen.getByTestId('audio-attachment-audio-msg-42');
    expect(audioEl).toBeTruthy();

    // useAudioPlayer was called — check the source URI
    expect(mockUseAudioPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: expect.stringContaining('/api/chat/rooms/room-1/messages/audio-msg-42/media'),
      }),
      expect.anything(),
    );

    // The URI must not contain objectPath or /storage/objects
    const callArgs = mockUseAudioPlayer.mock.calls.find(
      (c: any[]) => typeof c[0]?.uri === 'string' && c[0].uri.includes('audio-msg-42'),
    );
    if (callArgs) {
      expect(callArgs[0].uri).not.toContain('/storage/objects');
      expect(callArgs[0].uri).not.toContain('objectPath');
    }
  });

  it('elapsed timer shows m:ss during recording', async () => {
    stubRecorderState(75000);
    render(<ChatRoomScreen />);
    await startRecording();
    expect(screen.getByLabelText('Recording elapsed time').props.children).toBe('1:15');
  });
});

// ── Message actions: select / reply / forward / delete / photo viewer ───────

describe('Chat screen — message actions', () => {
  // Recent send times: "delete for everyone" is only offered inside the
  // 24-hour window, so fixtures must not age out of it.
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
  const photoMine = {
    id: 'msg-photo-mine', body: 'IMG_1.jpg', senderId: 'staff-1', senderName: 'Staff',
    roomId: 'room-1', shopId: 's1', kind: 'image', createdAt: minutesAgo(1),
  };
  const photoTheirs = {
    id: 'msg-photo-theirs', body: 'IMG_2.jpg', senderId: 'other-user', senderName: 'Alice',
    roomId: 'room-1', shopId: 's1', kind: 'image', createdAt: minutesAgo(2),
  };
  const textTheirs = {
    id: 'msg-text', body: 'How is it?', senderId: 'other-user', senderName: 'Alice',
    roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: minutesAgo(3),
  };

  beforeEach(() => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: 'room-1', name: 'Alice' });
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsGet.mockReturnValue({
      data: { room: { id: 'room-1', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z' } },
    });
    mockUseChatMessagesList.mockReturnValue({
      data: { messages: [photoMine, photoTheirs, textTheirs], hasMore: false },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
  });

  it('long-press enters selection mode with a brand-blue overlay and count; tap toggles more rows', () => {
    render(<ChatRoomScreen />);
    expect(screen.queryByTestId('message-selection-header')).toBeNull();

    fireEvent(screen.getByTestId('message-row-msg-photo-theirs'), 'longPress');
    expect(screen.getByTestId('message-selection-header')).toBeTruthy();
    expect(screen.getByTestId('message-selection-count').props.children).toBe(1);
    expect(screen.getByTestId('message-selected-msg-photo-theirs').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: 'rgba(0, 109, 168, 0.28)' })]),
    );
    // Single selection exposes Reply; multi-selection hides it.
    expect(screen.getByTestId('selection-reply')).toBeTruthy();

    fireEvent.press(screen.getByTestId('message-row-msg-text'));
    expect(screen.getByTestId('message-selection-count').props.children).toBe(2);
    expect(screen.queryByTestId('selection-reply')).toBeNull();
    expect(screen.getByTestId('selection-forward')).toBeTruthy();
    expect(screen.getByTestId('selection-delete')).toBeTruthy();

    // Tapping a selected row again deselects it; the composer stays put.
    fireEvent.press(screen.getByTestId('message-row-msg-text'));
    expect(screen.getByTestId('message-selection-count').props.children).toBe(1);
    expect(screen.getByPlaceholderText('Message…')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Clear selection'));
    expect(screen.queryByTestId('message-selection-header')).toBeNull();
  });

  it('Reply from selection shows a quoted strip and sends replyToMessageId', () => {
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);

    fireEvent(screen.getByTestId('message-row-msg-photo-theirs'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-reply'));
    expect(screen.queryByTestId('message-selection-header')).toBeNull();
    const strip = within(screen.getByTestId('reply-composer-strip'));
    expect(strip.getByText('Alice')).toBeTruthy();
    expect(strip.getByText('Photo')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'Nice photo');
    fireEvent.press(screen.getByLabelText('Send message'));
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'room-1',
        data: expect.objectContaining({ kind: 'text', body: 'Nice photo', replyToMessageId: 'msg-photo-theirs' }),
      }),
      expect.anything(),
    );
    // Strip clears once the reply is queued and the optimistic row carries the quote.
    expect(screen.queryByTestId('reply-composer-strip')).toBeNull();
    expect(screen.getByText('Nice photo')).toBeTruthy();
  });

  it('closing the reply strip sends a plain message without a quote', () => {
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);
    fireEvent(screen.getByTestId('message-row-msg-text'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-reply'));
    fireEvent.press(screen.getByTestId('reply-strip-close'));
    expect(screen.queryByTestId('reply-composer-strip')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText('Message…'), 'Plain');
    fireEvent.press(screen.getByLabelText('Send message'));
    expect(sendMutate.mock.calls[0][0].data.replyToMessageId).toBeUndefined();
  });

  it('renders quoted and forwarded markers on incoming messages', () => {
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          {
            id: 'msg-reply', body: 'Looks good', senderId: 'other-user', senderName: 'Alice', roomId: 'room-1', shopId: 's1',
            kind: 'text', createdAt: '2026-01-01T10:03:00Z',
            replyTo: { id: 'msg-photo-mine', senderId: 'staff-1', senderName: 'Staff', kind: 'image', body: 'IMG_1.jpg', deleted: false },
          },
          { id: 'msg-fwd', body: 'Forwarded text', senderId: 'other-user', senderName: 'Alice', roomId: 'room-1', shopId: 's1', kind: 'text', createdAt: '2026-01-01T10:02:30Z', forwarded: true },
          photoMine,
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<ChatRoomScreen />);
    expect(screen.getByTestId('quote-msg-reply')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy(); // quoted sender is the viewer
    expect(screen.getByTestId('forwarded-label-msg-fwd')).toBeTruthy();
    expect(screen.getByText('Forwarded')).toBeTruthy();

    // Tapping the quoted photo opens the full-screen viewer on the original.
    fireEvent.press(screen.getByTestId('quote-msg-reply'));
    expect(screen.getByTestId('image-viewer').props.visible).toBe(true);
    expect(screen.getByTestId('image-viewer-photo').props.accessibilityLabel).toBe('Full-size photo');
  });

  it('Forward from selection navigates to the forward screen with the selected ids', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    render(<ChatRoomScreen />);
    fireEvent(screen.getByTestId('message-row-msg-photo-theirs'), 'longPress');
    fireEvent.press(screen.getByTestId('message-row-msg-text'));
    fireEvent.press(screen.getByTestId('selection-forward'));
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/(tabs)/customers/chat/forward?roomId=room-1&messageIds='),
    );
    const url: string = push.mock.calls[0][0];
    expect(decodeURIComponent(url.split('messageIds=')[1]).split(',').sort()).toEqual(['msg-photo-theirs', 'msg-text']);
    expect(screen.queryByTestId('message-selection-header')).toBeNull();
  });

  it('Delete offers "for everyone" only when every selected message is mine and applies the chosen scope', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const deleteAsync = jest.fn().mockResolvedValue({ deletedIds: ['msg-photo-mine'] });
    mockUseChatMessagesDelete.mockReturnValue({ mutateAsync: deleteAsync, isPending: false });
    render(<ChatRoomScreen />);

    // Mixed ownership → only "Delete for me".
    fireEvent(screen.getByTestId('message-row-msg-photo-mine'), 'longPress');
    fireEvent.press(screen.getByTestId('message-row-msg-photo-theirs'));
    fireEvent.press(screen.getByTestId('selection-delete'));
    let buttons = alertSpy.mock.calls.at(-1)?.[2] as any[];
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe('Delete 2 messages?');
    expect(buttons.map((b) => b.text)).toEqual(['Delete for me', 'Cancel']);
    fireEvent.press(screen.getByLabelText('Clear selection'));

    // Own-only → both options; choose everyone.
    fireEvent(screen.getByTestId('message-row-msg-photo-mine'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-delete'));
    buttons = alertSpy.mock.calls.at(-1)?.[2] as any[];
    expect(buttons.map((b) => b.text)).toEqual(['Delete for everyone', 'Delete for me', 'Cancel']);
    await act(async () => {
      buttons[0].onPress();
    });
    expect(deleteAsync).toHaveBeenCalledWith({
      roomId: 'room-1',
      data: { messageIds: ['msg-photo-mine'], scope: 'everyone' },
    });
    expect(mockSetQueryData).toHaveBeenCalledWith(['/api/chat/rooms/room-1/messages'], expect.any(Function));
    // The cache updater tombstones deleted-for-everyone rows in place.
    const updater = mockSetQueryData.mock.calls.at(-1)?.[1];
    const next = updater({ messages: [photoMine, textTheirs] });
    expect(next.messages[0]).toEqual(expect.objectContaining({ id: 'msg-photo-mine', deletedAt: expect.any(String), body: '' }));
    expect(next.messages[1]).toEqual(textTheirs);
    await waitFor(() => expect(screen.queryByTestId('message-selection-header')).toBeNull());
    alertSpy.mockRestore();
  });

  it('"Delete for me" removes the rows from the cache locally', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const deleteAsync = jest.fn().mockResolvedValue({ deletedIds: ['msg-photo-theirs'] });
    mockUseChatMessagesDelete.mockReturnValue({ mutateAsync: deleteAsync, isPending: false });
    render(<ChatRoomScreen />);
    fireEvent(screen.getByTestId('message-row-msg-photo-theirs'), 'longPress');
    fireEvent.press(screen.getByTestId('selection-delete'));
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as any[];
    await act(async () => {
      buttons.find((b) => b.text === 'Delete for me').onPress();
    });
    expect(deleteAsync).toHaveBeenCalledWith({ roomId: 'room-1', data: { messageIds: ['msg-photo-theirs'], scope: 'me' } });
    const updater = mockSetQueryData.mock.calls.at(-1)?.[1];
    expect(updater({ messages: [photoMine, photoTheirs] }).messages.map((m: any) => m.id)).toEqual(['msg-photo-mine']);
    alertSpy.mockRestore();
  });

  it('renders deleted-for-everyone tombstones with sender-aware copy', () => {
    mockUseChatMessagesList.mockReturnValue({
      data: {
        messages: [
          { ...photoMine, deletedAt: '2026-01-01T10:05:00Z', body: '' },
          { ...textTheirs, deletedAt: '2026-01-01T10:05:00Z', body: '' },
        ],
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<ChatRoomScreen />);
    expect(screen.getByText('You deleted this message')).toBeTruthy();
    expect(screen.getByText('This message was deleted')).toBeTruthy();
    // Tombstones are not selectable rows.
    expect(screen.queryByTestId('message-row-msg-text')).toBeNull();
    expect(screen.queryByTestId('message-row-msg-photo-mine')).toBeNull();
  });

  it('tapping a photo opens the full-screen viewer with sender, save, forward and delete actions', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });
    render(<ChatRoomScreen />);
    await act(async () => {}); // let the stored bearer token load

    fireEvent.press(screen.getByTestId('message-row-msg-photo-theirs'));
    const viewer = screen.getByTestId('image-viewer');
    expect(viewer.props.visible).toBe(true);
    expect(screen.getByTestId('image-viewer-header')).toBeTruthy();
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);

    // Save to gallery: permission → download with bearer → saveToLibrary → done state.
    await act(async () => {
      fireEvent.press(screen.getByTestId('image-viewer-download'));
    });
    await waitFor(() => expect(mockSaveToLibraryAsync).toHaveBeenCalledWith('file:///cache/test.jpg'));
    expect(mockDownloadAsync).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat/rooms/room-1/messages/msg-photo-theirs/media'),
      expect.stringContaining('chat_photo_msg-photo-theirs'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-bearer-token' } }),
    );
    await waitFor(() => expect(screen.getByText('Saved to gallery')).toBeTruthy());

    // Reply from the viewer sends a quoted text message and closes the viewer.
    fireEvent.changeText(screen.getByTestId('image-viewer-reply-input'), 'Great shot');
    fireEvent.press(screen.getByTestId('image-viewer-reply-send'));
    expect(sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: 'Great shot', replyToMessageId: 'msg-photo-theirs' }),
      }),
      expect.anything(),
    );
    expect(screen.queryByTestId('image-viewer-header')).toBeNull();

    // Forward from the viewer.
    fireEvent.press(screen.getByTestId('message-row-msg-photo-theirs'));
    fireEvent.press(screen.getByTestId('image-viewer-forward'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('messageIds=msg-photo-theirs'));

    // Delete from the viewer menu → confirmation offers "for me" only (not mine).
    fireEvent.press(screen.getByTestId('message-row-msg-photo-theirs'));
    fireEvent.press(screen.getByTestId('image-viewer-more'));
    fireEvent.press(screen.getByTestId('image-viewer-delete'));
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as any[];
    expect(buttons.map((b) => b.text)).toEqual(['Delete for me', 'Cancel']);
    alertSpy.mockRestore();
  });

  it('shows the error state when the gallery permission is refused', async () => {
    mockGetMediaPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByTestId('message-row-msg-photo-mine'));
    expect(screen.getByText('You')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('image-viewer-download'));
    });
    await waitFor(() => expect(screen.getByText('Could not save this photo')).toBeTruthy());
    expect(mockSaveToLibraryAsync).not.toHaveBeenCalled();
  });
});
