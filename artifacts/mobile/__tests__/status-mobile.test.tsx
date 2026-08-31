import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);
const mockStatusesCreate = jest.fn().mockResolvedValue({ status: { id: 'created' } });
const mockStatusesDelete = jest.fn().mockResolvedValue(undefined);
const mockStatusesView = jest.fn().mockResolvedValue({ viewedAt: new Date().toISOString() });
const mockRefetch = jest.fn().mockResolvedValue(undefined);
let mockGroups: any[] = [];

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock('@workspace/api-client-react', () => ({
  getStatusesListQueryKey: () => ['/statuses'],
  statusesCreate: (...args: unknown[]) => mockStatusesCreate(...args),
  statusesDelete: (...args: unknown[]) => mockStatusesDelete(...args),
  statusesUploadUrl: jest.fn(),
  statusesView: (...args: unknown[]) => mockStatusesView(...args),
  useStatusesList: () => ({
    data: { groups: mockGroups },
    isLoading: false,
    isRefetching: false,
    isError: false,
    refetch: mockRefetch,
  }),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { All: 'All' },
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  createUploadTask: jest.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

jest.mock('@/utils/storage', () => ({
  KEYS: { AUTH_TOKEN: 'auth_token' },
  storage: { get: jest.fn(() => new Promise(() => {})) },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'me', name: 'My Account', profilePhoto: null },
  }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#111',
    card: '#fff',
    border: '#ddd',
    primary: '#06f',
    success: '#0a6',
    successLight: '#e8fff6',
    mutedForeground: '#667',
    surfaceSecondary: '#f5f5f5',
    surfaceElevated: '#fff',
    accent: '#eef4ff',
    destructive: '#f33',
  }),
}));

jest.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name }: { name: string }) => {
    const { Text } = require('react-native');
    return <Text>{name}</Text>;
  },
}));

jest.mock('@/components/status/StatusViewer', () => ({
  StatusViewer: ({ visible, group }: { visible: boolean; group: any }) => {
    const { Text } = require('react-native');
    return visible ? <Text testID="status-viewer">{group?.name}</Text> : null;
  },
}));

const StatusScreen = require('@/app/(tabs)/status').default;

describe('Status Updates mobile screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroups = [];
  });

  it('shows a real empty state and publishes a text status through the API', async () => {
    const screen = render(<StatusScreen />);
    expect(screen.getByText('No recent updates')).toBeTruthy();
    fireEvent.press(screen.getByTestId('add-status'));
    fireEvent.changeText(screen.getByPlaceholderText('Type a status'), 'Live from my phone');
    fireEvent.press(screen.getByTestId('publish-status'));
    await waitFor(() => {
      expect(mockStatusesCreate).toHaveBeenCalledWith({
        kind: 'text',
        body: 'Live from my phone',
        audience: 'contacts',
      });
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['/statuses'] });
  });

  it('groups contact updates and opens the selected sequence', () => {
    mockGroups = [{
      userId: 'contact-1',
      name: 'Real Contact',
      profilePhoto: null,
      hasUnviewed: true,
      latestAt: new Date().toISOString(),
      items: [{
        id: 'status-1',
        authorId: 'contact-1',
        authorName: 'Real Contact',
        authorPhoto: null,
        kind: 'text',
        body: 'Available today',
        objectPath: null,
        mediaUrl: null,
        mimeType: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        viewed: false,
        viewerCount: 0,
      }],
    }];
    const screen = render(<StatusScreen />);
    expect(screen.getByText('Recent updates')).toBeTruthy();
    fireEvent.press(screen.getByTestId('status-group-contact-1'));
    expect(screen.getByTestId('status-viewer')).toBeTruthy();
  });
});