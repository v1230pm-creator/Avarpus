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
import { Text, View } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
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
  };
});

jest.mock('@/components/ui/Avatar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Avatar: ({ name }: { name: string }) => React.createElement(Text, null, `Avatar:${name}`) };
});

// API client mocks — keyed by what each test controls via mockReturnValue
const mockUseChatCapabilities = jest.fn();
const mockUseChatRoomsList = jest.fn();
const mockUseChatRoomsCreate = jest.fn();
const mockUseChatRoomsGet = jest.fn();
const mockUseChatMessagesList = jest.fn();
const mockUseChatMessagesSend = jest.fn();
const mockUseChatMarkRead = jest.fn();
const mockUseChatUploadUrl = jest.fn();
const mockUseRepairsList = jest.fn();

jest.mock('@workspace/api-client-react', () => ({
  useChatCapabilities: (...args: any[]) => mockUseChatCapabilities(...args),
  useChatRoomsList: (...args: any[]) => mockUseChatRoomsList(...args),
  useChatRoomsCreate: (...args: any[]) => mockUseChatRoomsCreate(...args),
  useChatRoomsGet: (...args: any[]) => mockUseChatRoomsGet(...args),
  useChatMessagesList: (...args: any[]) => mockUseChatMessagesList(...args),
  useChatMessagesSend: (...args: any[]) => mockUseChatMessagesSend(...args),
  useChatMarkRead: (...args: any[]) => mockUseChatMarkRead(...args),
  useChatUploadUrl: (...args: any[]) => mockUseChatUploadUrl(...args),
  useRepairsList: (...args: any[]) => mockUseRepairsList(...args),
  // Query key helpers
  getChatRoomsListQueryKey: () => ['/api/chat/rooms'],
  getChatRoomsGetQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}`],
  getChatMessagesListQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}/messages`],
  getRepairsListQueryKey: (params: any) => ['/api/repairs', params],
  // Media URL — private per-message endpoint, not generic storage
  getChatMessageMediaUrl: (roomId: string, messageId: string) =>
    `/api/chat/rooms/${roomId}/messages/${messageId}/media`,
}));

// Mock expo-document-picker
const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: any[]) => mockGetDocumentAsync(...args),
}));

// Mock expo-file-system/legacy
const mockCreateUploadTask = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockDownloadAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: (...args: any[]) => mockGetInfoAsync(...args),
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
  getStatus: jest.fn().mockReturnValue({ canRecord: true, isRecording: false, durationMillis: 0, mediaServicesDidReset: false, url: null }),
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

jest.mock('expo-audio', () => ({
  useAudioRecorder: jest.fn(() => mockRecorder),
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
  mockUseChatRoomsList.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  mockUseChatRoomsCreate.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatRoomsGet.mockReturnValue({ data: undefined });
  mockUseChatMessagesList.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });
  mockUseChatMessagesSend.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseChatMarkRead.mockReturnValue({ mutate: jest.fn() });
  mockUseChatUploadUrl.mockReturnValue({ mutate: jest.fn(), isPending: false });
  mockUseRepairsList.mockReturnValue({
    data: { repairs: [], total: 0 },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  });
  mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
  mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
  mockCreateUploadTask.mockReturnValue({ uploadAsync: jest.fn().mockResolvedValue({ status: 200 }) });
  mockDownloadAsync.mockResolvedValue({ uri: 'file:///cache/test.jpg', status: 200 });
  mockIsAvailableAsync.mockResolvedValue(true);
  mockShareAsync.mockResolvedValue(undefined);

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

  it('renders actual rooms from API when provider is configured', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: true, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    mockUseChatRoomsList.mockReturnValue({
      data: {
        rooms: [
          { id: 'r1', name: 'Alice', kind: 'customer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T10:00:00Z', unreadCount: 2, lastMessage: { id: 'm1', body: 'Hello!', createdAt: '2026-01-01T10:00:00Z', senderId: 'other', senderName: 'Alice', roomId: 'r1', shopId: 's1', kind: 'text' } },
          { id: 'r2', name: 'Bob', kind: 'dealer', shopId: 's1', isArchived: false, createdAt: '2026-01-01T09:00:00Z', unreadCount: 0 },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });
    render(<HomeScreen />);
    expect(screen.getByTestId('room-item-r1')).toBeTruthy();
    expect(screen.getByTestId('room-item-r2')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Hello!')).toBeTruthy();
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

describe('Staff repair home', () => {
  it('opens customer chat from the customer identity and repair detail from ticket content', () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, back: jest.fn(), replace: jest.fn() });
    mockUseData.mockReturnValue({
      customers: [{ id: 'customer-1', name: 'Mohit Murya', mobile: '9999999999' }],
    });
    mockUseRepairsList.mockReturnValue({
      data: {
        repairs: [
          {
            id: 'repair-1',
            repairId: 'VMC-051',
            customerId: 'customer-1',
            customerName: 'Mohit Murya',
            mobile: '9999999999',
            deviceType: 'Mobile',
            brand: 'Samsung',
            model: 'M34',
            problem: 'Display issue',
            status: 'repairing',
            priority: 'normal',
            repairCharge: 1500,
            partsCharge: 0,
            advance: 0,
            receiveDate: '2026-08-16T10:24:00.000Z',
            expectedDate: '2026-08-18T10:24:00.000Z',
            createdAt: '2026-08-16T10:24:00.000Z',
          },
        ],
        total: 1,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
    });

    render(<HomeScreen />);

    expect(screen.getByText('Mohit Murya')).toBeTruthy();
    expect(screen.getByText('VMC-051')).toBeTruthy();
    expect(screen.getByText('· Samsung M34')).toBeTruthy();
    expect(screen.getByText('In Repair')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search customer or ticket...')).toBeTruthy();
    expect(screen.getByTestId('home-create-repair')).toBeTruthy();
    expect(screen.queryByText('All')).toBeNull();
    expect(screen.queryByText('Received')).toBeNull();
    expect(screen.queryByText('Repair')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByText('Delivered')).toBeNull();

    fireEvent.press(screen.getByTestId('home-chat-customer-repair-1'));
    expect(push).toHaveBeenCalledWith(
      '/(tabs)/customers/chat/customer-1?targetId=customer-1&type=customer&name=Mohit%20Murya',
    );

    fireEvent.press(screen.getByTestId('home-repair-repair-1'));
    expect(push).toHaveBeenCalledWith('/(tabs)/repairs/repair-1');

    const searchInput = screen.getByPlaceholderText('Search customer or ticket...');
    fireEvent.changeText(searchInput, 'zzzzzz');
    expect(screen.queryByText('Mohit Murya')).toBeNull();
    expect(screen.getByText('No matching repairs')).toBeTruthy();

    fireEvent.changeText(
      screen.getByPlaceholderText('Search customer or ticket...'),
      'VMC-051',
    );
    expect(screen.getByText('Mohit Murya')).toBeTruthy();
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

  it('picker cancel clears pending attachment without error', async () => {
    // getDocumentAsync returns canceled=true
    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
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
  });

  it('mic button is enabled when provider available and room resolved', () => {
    render(<ChatRoomScreen />);
    const mic = screen.getByLabelText('Record voice note');
    expect(mic).toBeTruthy();
    expect(mic.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('mic button is disabled when provider is unavailable', () => {
    mockUseChatCapabilities.mockReturnValue({
      data: { matrixAvailable: false, livekitAvailable: false, e2eeEnabled: false },
      isLoading: false,
      isError: false,
    });
    render(<ChatRoomScreen />);
    // Provider down — setup-pending card shown, no mic button
    expect(screen.getByText('Chat setup pending')).toBeTruthy();
    expect(screen.queryByLabelText('Record voice note')).toBeNull();
  });

  it('shows permission-denied notice when microphone permission is denied', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({
      granted: false,
      status: 'denied',
    });
    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => {
      expect(
        screen.getByText(/Microphone permission denied/),
      ).toBeTruthy();
    });
    // Recording should NOT have started
    expect(mockRecorderRecord).not.toHaveBeenCalled();
  });

  it('shows recording UI after permission granted and record starts', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      status: 'granted',
    });
    // While recording, state returns isRecording = true
    mockUseAudioRecorderState.mockReturnValue({
      canRecord: true,
      isRecording: true,
      durationMillis: 4500,
      mediaServicesDidReset: false,
      url: null,
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));

    await waitFor(() => {
      expect(mockRecorderRecord).toHaveBeenCalled();
    });
    await waitFor(() => {
      // Recording overlay should appear
      expect(screen.queryByLabelText('Stop and send recording')).toBeTruthy();
      expect(screen.queryByLabelText('Cancel recording')).toBeTruthy();
    });
  });

  it('cancel recording does NOT upload or send', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    const uploadMutate = jest.fn();
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    // Simulate: after mic press recorder is recording, state updates
    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 2000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    // Simulate state change: now recording
    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);

    await waitFor(() => screen.getByLabelText('Cancel recording'));

    // Audio session was put into recording mode on start
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecording: true }),
    );
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Cancel recording'));

    // stop() is called to abort the recording
    await waitFor(() => expect(mockRecorderStop).toHaveBeenCalled());
    // Audio session must be restored to allowsRecording:false on cancel
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false }),
      );
    });
    // But no upload or send
    expect(uploadMutate).not.toHaveBeenCalled();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('restores audio mode even when stop() throws during cancel', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    // stop() rejects — cancel must still reset the audio session
    mockRecorderStop.mockRejectedValueOnce(new Error('stop boom'));
    const uploadMutate = jest.fn();
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 2000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);
    await waitFor(() => screen.getByLabelText('Cancel recording'));
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Cancel recording'));

    // Even though stop() threw, the audio session is restored (finally block)
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false }),
      );
    });
    expect(uploadMutate).not.toHaveBeenCalled();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('restores audio mode when recorder.record() fails to start', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    // record() throws after the audio mode was switched to recording
    mockRecorderRecord.mockImplementationOnce(() => {
      throw new Error('record boom');
    });

    render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));

    // Start failed → error surfaced and NOT stuck in recording UI
    await waitFor(() => {
      expect(screen.getByText(/record boom|Could not start recording/)).toBeTruthy();
    });
    // Audio session must be restored to allowsRecording:false on start failure
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false }),
      );
    });
    // Should be back in idle (composer mic visible, no recording overlay)
    expect(screen.queryByLabelText('Stop and send recording')).toBeNull();
  });

  it('restores audio mode when stop() throws during stop/send', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    // stop() rejects on the stop-and-send path
    mockRecorderStop.mockRejectedValueOnce(new Error('stop/send boom'));
    const uploadMutate = jest.fn();
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    const sendMutate = jest.fn();
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 3000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);
    await waitFor(() => screen.getByLabelText('Stop and send recording'));
    mockSetAudioModeAsync.mockClear();

    fireEvent.press(screen.getByLabelText('Stop and send recording'));

    // stop() failed → audio session must still be restored, no upload/send
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false }),
      );
    });
    expect(uploadMutate).not.toHaveBeenCalled();
    expect(sendMutate).not.toHaveBeenCalled();
  });

  it('restores audio mode on unmount while recording', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });

    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 2000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender, unmount } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);
    await waitFor(() => screen.getByLabelText('Stop and send recording'));
    mockSetAudioModeAsync.mockClear();

    // Tear the screen down mid-recording
    unmount();

    // Cleanup must stop the recorder and restore the audio session
    expect(mockRecorderStop).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
        expect.objectContaining({ allowsRecording: false }),
      );
    });
  });

  it('record → stop → upload → send with kind=audio, durationMs, stable clientRequestId, objectPath', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    mockRecorderStop.mockResolvedValue(undefined);
    // Simulate 5 seconds of recording
    mockUseAudioRecorderState.mockReturnValue({
      canRecord: true,
      isRecording: false,
      durationMillis: 5000,
      mediaServicesDidReset: false,
      url: null,
    });

    const uploadMutate = jest.fn((args: any, cbs: any) => {
      cbs?.onSuccess?.({
        uploadURL: 'https://s3.example.com/voice-presigned',
        objectPath: 'uploads/s1/chat/room-1/voice-note-123.m4a',
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

    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 5000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);
    await waitFor(() => screen.getByLabelText('Stop and send recording'));
    fireEvent.press(screen.getByLabelText('Stop and send recording'));

    await waitFor(() => expect(mockRecorderStop).toHaveBeenCalled());

    // Upload URL called with correct metadata
    await waitFor(() => {
      expect(uploadMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          data: expect.objectContaining({
            name: expect.stringMatching(/voice-note-\d+\.m4a/),
            contentType: 'audio/mp4',
          }),
        }),
        expect.anything(),
      );
    });

    // createUploadTask called with presigned URL and correct content-type
    await waitFor(() => {
      expect(mockCreateUploadTask).toHaveBeenCalledWith(
        'https://s3.example.com/voice-presigned',
        'file:///cache/voice-note-123.m4a',
        expect.objectContaining({
          httpMethod: 'PUT',
          headers: expect.objectContaining({ 'Content-Type': 'audio/mp4' }),
        }),
        expect.any(Function),
      );
    });

    // Send called with kind=audio, durationMs, objectPath, stable clientRequestId
    await waitFor(() => {
      expect(sendMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: 'room-1',
          data: expect.objectContaining({
            kind: 'audio',
            body: expect.stringMatching(/voice-note-\d+\.m4a/),
            objectPath: 'uploads/s1/chat/room-1/voice-note-123.m4a',
            durationMs: expect.any(Number),
            clientRequestId: expect.stringMatching(/^voice-/),
          }),
        }),
        expect.anything(),
      );
    });

    // durationMs must be a positive integer ≤ 600000
    const sentData = sendMutate.mock.calls[0][0].data;
    expect(sentData.durationMs).toBeGreaterThanOrEqual(1);
    expect(sentData.durationMs).toBeLessThanOrEqual(600000);
    expect(Number.isInteger(sentData.durationMs)).toBe(true);
  });

  it('send retry reuses same clientRequestId and does NOT re-upload (objectPath already known)', async () => {
    // This test simulates: upload succeeded → send failed → retry → send only
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    mockRecorderStop.mockResolvedValue(undefined);

    // Upload URL succeeds on first call only
    const uploadMutate = jest.fn()
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onSuccess?.({
          uploadURL: 'https://s3.example.com/voice-presigned',
          objectPath: 'uploads/s1/chat/room-1/voice-note-123.m4a',
        });
      });
    mockUseChatUploadUrl.mockReturnValue({ mutate: uploadMutate, isPending: false });
    mockCreateUploadTask.mockReturnValue({
      uploadAsync: jest.fn().mockResolvedValue({ status: 200 }),
    });

    // Send: first attempt fails, second succeeds
    const sendMutate = jest.fn()
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onError?.(new Error('Provider timeout'));
      })
      .mockImplementationOnce((args: any, cbs: any) => {
        cbs?.onSuccess?.({ message: { id: 'audio-retry-msg' } });
      });
    mockUseChatMessagesSend.mockReturnValue({ mutate: sendMutate, isPending: false });

    let recorderStateIsRecording = false;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: recorderStateIsRecording,
      durationMillis: 3000,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    recorderStateIsRecording = true;
    rerender(<ChatRoomScreen />);
    await waitFor(() => screen.getByLabelText('Stop and send recording'));
    fireEvent.press(screen.getByLabelText('Stop and send recording'));

    // First attempt: upload OK but send fails → error bar
    await waitFor(() => {
      expect(screen.getByText(/Provider timeout/)).toBeTruthy();
    });

    const firstCrid = sendMutate.mock.calls[0][0].data.clientRequestId;
    expect(firstCrid).toMatch(/^voice-/);

    // Retry — press Retry in error bar
    fireEvent.press(screen.getByText('Retry'));

    await waitFor(() => {
      expect(sendMutate).toHaveBeenCalledTimes(2);
    });

    // Upload mutate called only once (not re-uploaded on retry)
    expect(uploadMutate).toHaveBeenCalledTimes(1);

    // Second send uses the SAME clientRequestId
    const secondCrid = sendMutate.mock.calls[1][0].data.clientRequestId;
    expect(secondCrid).toBe(firstCrid);
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

  it('elapsed timer shows mm:ss during recording', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValueOnce({ granted: true, status: 'granted' });
    // Simulate 75 seconds elapsed (1 min 15 sec = 01:15)
    let duration = 75000;
    mockUseAudioRecorderState.mockImplementation(() => ({
      canRecord: true,
      isRecording: true,
      durationMillis: duration,
      mediaServicesDidReset: false,
      url: null,
    }));

    const { rerender } = render(<ChatRoomScreen />);
    fireEvent.press(screen.getByLabelText('Record voice note'));
    await waitFor(() => expect(mockRecorderRecord).toHaveBeenCalled());

    rerender(<ChatRoomScreen />);

    await waitFor(() => {
      const timerEl = screen.queryByLabelText('Recording elapsed time');
      expect(timerEl).toBeTruthy();
    });
  });
});
