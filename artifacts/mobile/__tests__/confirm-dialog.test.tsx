/**
 * The app-wide delete confirmation: one dialog design for every destructive
 * action. Guards the layout contract (icon, title, "cannot be undone" line,
 * uppercase stacked actions with descriptions, outlined CANCEL), that the
 * root Modal hands rendering to a host mounted inside another Modal, and
 * that async actions block double-taps until they settle.
 */
import React from 'react';
import { Modal, Text, TouchableOpacity } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConfirmDialogHost, ConfirmDialogProvider, useConfirmDialog, type ConfirmOptions } from '@/components/ui/ConfirmDialog';

jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: ({ children, ...rest }: any) => <View {...rest}>{children}</View> };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

function Trigger({ options, label = 'open' }: { options: ConfirmOptions; label?: string }) {
  const { confirm } = useConfirmDialog();
  return (
    <TouchableOpacity onPress={() => confirm(options)}>
      <Text>{label}</Text>
    </TouchableOpacity>
  );
}

describe('ConfirmDialog', () => {
  it('renders the delete-message layout and routes taps to the right action', () => {
    const everyone = jest.fn();
    const me = jest.fn();
    render(
      <ConfirmDialogProvider>
        <Trigger
          options={{
            title: 'Delete message?',
            actions: [
              { label: 'Delete for everyone', description: 'Remove for all participants', onPress: everyone },
              { label: 'Delete for me', description: 'Remove only from this device', onPress: me },
            ],
          }}
        />
      </ConfirmDialogProvider>,
    );
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    fireEvent.press(screen.getByText('open'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText('Delete message?')).toBeTruthy();
    expect(screen.getByText('This action cannot be undone.')).toBeTruthy();
    expect(screen.getByText('DELETE FOR EVERYONE')).toBeTruthy();
    expect(screen.getByText('Remove for all participants')).toBeTruthy();
    expect(screen.getByText('DELETE FOR ME')).toBeTruthy();
    expect(screen.getByText('Remove only from this device')).toBeTruthy();
    expect(screen.getByText('CANCEL')).toBeTruthy();

    fireEvent.press(screen.getByText('DELETE FOR ME'));
    expect(me).toHaveBeenCalledTimes(1);
    expect(everyone).not.toHaveBeenCalled();
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('cancel and backdrop close without running any action', () => {
    const onPress = jest.fn();
    const onCancel = jest.fn();
    render(
      <ConfirmDialogProvider>
        <Trigger options={{ title: 'Delete repair?', actions: [{ label: 'Delete repair', onPress }], onCancel }} />
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('open'));
    fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    fireEvent.press(screen.getByText('open'));
    fireEvent.press(screen.getByTestId('confirm-dialog-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('keeps the dialog up and blocks a second tap while an async action runs', async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => { resolve = r; });
    const onPress = jest.fn(() => pending);
    render(
      <ConfirmDialogProvider>
        <Trigger options={{ title: 'Delete status?', actions: [{ label: 'Delete status', onPress }] }} />
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('open'));
    fireEvent.press(screen.getByTestId('confirm-action-0'));
    fireEvent.press(screen.getByTestId('confirm-action-0'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();

    await act(async () => { resolve(); await pending; });
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('shows a custom message above the "cannot be undone" caption, or drops the caption when reversible', () => {
    render(
      <ConfirmDialogProvider>
        <Trigger label="chats" options={{ title: 'Delete 2 chats?', message: 'Only hidden for you.', actions: [{ label: 'Delete for me', onPress: jest.fn() }] }} />
        <Trigger label="backup" options={{ title: 'Google Account', message: 'Manage backup.', caption: null, actions: [{ label: 'Disconnect', onPress: jest.fn() }] }} />
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('chats'));
    expect(screen.getByText('Only hidden for you.')).toBeTruthy();
    expect(screen.getByText('This action cannot be undone.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('confirm-cancel'));

    fireEvent.press(screen.getByText('backup'));
    expect(screen.getByText('Manage backup.')).toBeTruthy();
    expect(screen.queryByText('This action cannot be undone.')).toBeNull();
  });

  it('a newer request is not closed by an older async action settling', async () => {
    let resolveFirst!: () => void;
    const first = jest.fn(() => new Promise<void>((r) => { resolveFirst = r; }));
    const second = jest.fn();
    render(
      <ConfirmDialogProvider>
        <Trigger label="one" options={{ title: 'First?', actions: [{ label: 'Go one', onPress: first }] }} />
        <Trigger label="two" options={{ title: 'Second?', actions: [{ label: 'Go two', onPress: second }] }} />
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('one'));
    fireEvent.press(screen.getByTestId('confirm-action-0'));
    // Something else opens a fresh confirmation while the first is still running.
    fireEvent.press(screen.getByText('two'));
    expect(screen.getByText('Second?')).toBeTruthy();
    await act(async () => { resolveFirst(); });
    expect(screen.getByText('Second?')).toBeTruthy();
    fireEvent.press(screen.getByText('GO TWO'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });

  it('a rejected async action releases the dialog', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onPress = jest.fn(() => Promise.reject(new Error('network')));
    render(
      <ConfirmDialogProvider>
        <Trigger options={{ title: 'Delete?', actions: [{ label: 'Delete', onPress }] }} />
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('open'));
    await act(async () => { fireEvent.press(screen.getByTestId('confirm-action-0')); });
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    warn.mockRestore();
  });

  it('cancels an open request when its host unmounts, and never re-shows it on remount', () => {
    const onPress = jest.fn();
    const onCancel = jest.fn();
    function Screen() {
      const [open, setOpen] = React.useState(true);
      return (
        <ConfirmDialogProvider>
          <TouchableOpacity onPress={() => setOpen((v) => !v)}><Text>toggle</Text></TouchableOpacity>
          {open && (
            <Modal visible transparent>
              <Trigger options={{ title: 'Delete status?', actions: [{ label: 'Delete status', onPress }], onCancel }} />
              <ConfirmDialogHost />
            </Modal>
          )}
        </ConfirmDialogProvider>
      );
    }
    render(<Screen />);
    fireEvent.press(screen.getByText('open'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();

    // Outer modal goes away (Android back, auto-advance): request is cancelled.
    fireEvent.press(screen.getByText('toggle'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();

    // Remounting the same host must not resurrect the old confirmation.
    fireEvent.press(screen.getByText('toggle'));
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders inside a mounted host instead of the root Modal', () => {
    const onPress = jest.fn();
    render(
      <ConfirmDialogProvider>
        <Modal visible transparent>
          <Trigger options={{ title: 'Discard changes?', actions: [{ label: 'Discard changes', onPress }] }} />
          <ConfirmDialogHost />
        </Modal>
      </ConfirmDialogProvider>,
    );
    fireEvent.press(screen.getByText('open'));
    // Exactly one dialog is drawn, and it is the inline host copy (no nested Modal).
    expect(screen.getAllByTestId('confirm-dialog')).toHaveLength(1);
    expect(screen.getByText('DISCARD CHANGES')).toBeTruthy();
    fireEvent.press(screen.getByText('DISCARD CHANGES'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
  });
});
