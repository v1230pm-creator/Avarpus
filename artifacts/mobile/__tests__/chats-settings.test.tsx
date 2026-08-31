import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ChatsSettingsScreen from '../app/(tabs)/more/chats';

const mockBack = jest.fn();
const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#0b1114',
    backgroundSecondary: '#20282c',
    foreground: '#f4f7f8',
    mutedForeground: '#9aa6ab',
    border: '#253136',
    success: '#22c76a',
    primary: '#56b7ff',
  }),
}));

jest.mock('@/utils/storage', () => ({
  storage: {
    get: (...args: any[]) => mockStorageGet(...args),
    set: (...args: any[]) => mockStorageSet(...args),
  },
}));

describe('Chats settings screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageSet.mockResolvedValue(undefined);
  });

  it('renders the WhatsApp-style chat settings sections and actions', () => {
    render(<ChatsSettingsScreen />);

    expect(screen.getByText('Chats')).toBeTruthy();
    expect(screen.getByText('Chat settings')).toBeTruthy();
    expect(screen.getByText('Enter is send')).toBeTruthy();
    expect(screen.getByText('Media visibility')).toBeTruthy();
    expect(screen.getByText('Font size')).toBeTruthy();
    expect(screen.getByText('Voice message transcripts')).toBeTruthy();
    expect(screen.getByText('Sticker suggestions')).toBeTruthy();
    expect(screen.getByText('Archived chats')).toBeTruthy();
    expect(screen.getByText('Keep chats archived')).toBeTruthy();
    expect(screen.getByText('Chat backup')).toBeTruthy();
    expect(screen.getByText('Transfer chats')).toBeTruthy();
    expect(screen.getByText('Chat history')).toBeTruthy();
  });

  it('persists toggle changes and restores saved settings', async () => {
    mockStorageGet.mockResolvedValueOnce({
      enterIsSend: true,
      mediaVisibility: false,
      fontSize: 'Large',
    });
    render(<ChatsSettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText('Large')).toBeTruthy();
      expect(screen.getByLabelText('Media visibility').props.value).toBe(false);
    });

    fireEvent(screen.getByLabelText('Sticker suggestions'), 'valueChange', false);
    await waitFor(() => {
      expect(mockStorageSet).toHaveBeenCalledWith(
        'avarpus_chat_settings',
        expect.objectContaining({ stickerSuggestions: false }),
      );
    });
  });

  it('offers font-size choices and navigates back from the page', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(<ChatsSettingsScreen />);

    fireEvent.press(screen.getByLabelText('Font size'));
    const buttons = alertSpy.mock.calls.at(-1)?.[2] as Array<{
      text?: string;
      onPress?: () => void;
    }>;
    buttons.find((button) => button.text === 'Large')?.onPress?.();
    fireEvent.press(screen.getByLabelText('Go back'));

    expect(mockStorageSet).toHaveBeenCalledWith(
      'avarpus_chat_settings',
      expect.objectContaining({ fontSize: 'Large' }),
    );
    expect(mockBack).toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});