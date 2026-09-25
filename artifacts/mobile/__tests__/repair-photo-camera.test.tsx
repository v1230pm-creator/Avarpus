/**
 * The intake form's in-app camera: the viewfinder opens directly with the
 * newest gallery photos under it, one shutter and a flip — no mode rail. A
 * capture or a gallery pick is reviewed, given its category, normalised to a
 * cache JPEG and handed back; permission problems show a way out instead of
 * a dead screen.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

let mockCameraPermission: any = { granted: true, canAskAgain: true, status: 'granted' };
const mockRequestCameraPermission = jest.fn(async () => mockCameraPermission);
const mockGetCameraPermission = jest.fn(async () => mockCameraPermission);
const mockTakePictureAsync = jest.fn(async () => ({ uri: 'file:///cache/Camera/capture.jpg', width: 4000, height: 3000 }));
const mockCameraViewProps: any[] = [];

jest.mock('expo-camera', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const CameraView = ReactLib.forwardRef((props: any, ref: any) => {
    mockCameraViewProps.push(props);
    ReactLib.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePictureAsync }));
    ReactLib.useEffect(() => { props.onCameraReady?.(); }, []);
    return ReactLib.createElement(View, { testID: 'mock-camera-view' });
  });
  return {
    CameraView,
    useCameraPermissions: () => [mockCameraPermission, mockRequestCameraPermission, mockGetCameraPermission],
  };
});

let mockMediaPermission: any = { granted: true, canAskAgain: true, accessPrivileges: 'all' };
const mockAssetsPage1 = [
  { id: 'a1', uri: 'file:///dcim/1.jpg', filename: '1.jpg', width: 3000, height: 4000, mediaType: 'photo' },
  { id: 'a2', uri: 'file:///dcim/2.jpg', filename: '2.jpg', width: 1200, height: 1600, mediaType: 'photo' },
];
const mockGetAssetsAsync = jest.fn(async (opts: any) => (
  opts?.after
    ? { assets: [{ id: 'a3', uri: 'file:///dcim/3.jpg', filename: '3.jpg', width: 800, height: 600, mediaType: 'photo' }], endCursor: 'a3', hasNextPage: false }
    : { assets: mockAssetsPage1, endCursor: 'a2', hasNextPage: true }
));
const mockGetAssetInfoAsync = jest.fn(async (id: string) => ({ localUri: `file:///resolved/${id}.jpg` }));
const mockRequestMediaPermission = jest.fn(async () => mockMediaPermission);
jest.mock('expo-media-library/legacy', () => ({
  getPermissionsAsync: jest.fn(async () => mockMediaPermission),
  requestPermissionsAsync: (..._args: any[]) => mockRequestMediaPermission(),
  getAssetsAsync: (opts?: any) => mockGetAssetsAsync(opts),
  getAssetInfoAsync: (id: string) => mockGetAssetInfoAsync(id),
  presentPermissionsPickerAsync: jest.fn(async () => {}),
}));

const mockDeleteAsync = jest.fn(async (_uri: string, _opts?: any) => {});
jest.mock('expo-file-system/legacy', () => ({ deleteAsync: (uri: string, opts?: any) => mockDeleteAsync(uri, opts) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => {}), ImpactFeedbackStyle: { Light: 'light' } }));

const mockImageProps: any[] = [];
jest.mock('expo-image', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: any) => {
      mockImageProps.push(props);
      return ReactLib.createElement(View, { testID: 'expo-image', accessibilityLabel: props.accessibilityLabel });
    },
  };
});

const mockPrepareRepairPhoto = jest.fn(async (src: { uri: string }) => ({ uri: `file:///cache/prepared/${src.uri.split('/').pop()}`, width: 2000, height: 1500 }));
jest.mock('@/utils/repairPhoto', () => ({ prepareRepairPhoto: (src: { uri: string }) => mockPrepareRepairPhoto(src) }));

import { FlatList, Linking } from 'react-native';
import { RepairPhotoCamera } from '@/components/ui/RepairPhotoCamera';

const mockOpenSettings = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => {});

const KINDS = [
  { id: 'front', label: 'Front' },
  { id: 'imei', label: 'IMEI / Serial' },
];

async function renderCamera(overrides: Partial<React.ComponentProps<typeof RepairPhotoCamera>> = {}) {
  const onClose = jest.fn();
  const onPicked = jest.fn();
  const utils = render(<RepairPhotoCamera visible kinds={KINDS} onClose={onClose} onPicked={onPicked} {...overrides} />);
  await act(async () => {});
  await act(async () => {});
  return { ...utils, onClose, onPicked };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOpenSettings.mockImplementation(async () => {});
  mockCameraPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockMediaPermission = { granted: true, canAskAgain: true, accessPrivileges: 'all' };
  mockCameraViewProps.length = 0;
  mockImageProps.length = 0;
});

test('opens straight on the viewfinder with the gallery strip, a shutter and a flip — nothing else', async () => {
  await renderCamera();

  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
  expect(mockCameraViewProps[0].mode).toBe('picture');
  expect(mockCameraViewProps[0].facing).toBe('back');
  expect(screen.getByTestId('repair-camera-shutter')).toBeTruthy();
  expect(screen.getByTestId('repair-camera-flip')).toBeTruthy();
  expect(screen.getByTestId('repair-camera-recent-a1')).toBeTruthy();
  expect(screen.getByTestId('repair-camera-recent-a2')).toBeTruthy();
  expect(mockGetAssetsAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaType: ['photo'], first: 30 }));
  // Photos only: no video, no mode names.
  expect(screen.queryByText(/video/i)).toBeNull();
  expect(screen.queryByText(/portrait/i)).toBeNull();

  fireEvent.press(screen.getByTestId('repair-camera-flip'));
  expect(mockCameraViewProps[mockCameraViewProps.length - 1].facing).toBe('front');
  // The shutter stays usable after the flip.
  expect(screen.getByTestId('repair-camera-shutter').props.accessibilityState).toEqual({ disabled: false });
});

test('shutter → review → category hands back a normalised cache JPEG and drops the raw capture', async () => {
  const { onPicked } = await renderCamera();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-shutter')); });
  expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Which photo is this?')).toBeTruthy();
  expect(screen.getByTestId('repair-camera-kind-front')).toBeTruthy();
  expect(onPicked).not.toHaveBeenCalled();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-kind-imei')); });
  expect(mockPrepareRepairPhoto).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///cache/Camera/capture.jpg', width: 4000, height: 3000 }));
  expect(onPicked).toHaveBeenCalledWith({ uri: 'file:///cache/prepared/capture.jpg', kind: 'imei' });
  expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/Camera/capture.jpg', { idempotent: true });
});

test('retake from the review deletes the rejected capture and returns to the viewfinder', async () => {
  const { onClose, onPicked } = await renderCamera();
  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-shutter')); });

  // The viewfinder stays mounted under the review so a retake is instant.
  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-retake')); });
  expect(mockDeleteAsync).toHaveBeenCalledWith('file:///cache/Camera/capture.jpg', { idempotent: true });
  expect(screen.queryByText('Which photo is this?')).toBeNull();
  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(onPicked).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId('repair-camera-close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a gallery strip photo is resolved through the asset id, reviewed and returned; the original is never deleted', async () => {
  const { onPicked } = await renderCamera();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-recent-a2')); });
  expect(mockGetAssetInfoAsync).toHaveBeenCalledWith('a2');
  expect(screen.getByText('Which photo is this?')).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-kind-front')); });
  expect(mockPrepareRepairPhoto).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///resolved/a2.jpg', width: 1200, height: 1600 }));
  expect(onPicked).toHaveBeenCalledWith({ uri: 'file:///cache/prepared/a2.jpg', kind: 'front' });
  expect(mockDeleteAsync).not.toHaveBeenCalled();
});

test('the full gallery is a paginated grid inside the camera, and back from its review returns to the grid', async () => {
  await renderCamera();

  fireEvent.press(screen.getByTestId('repair-camera-gallery'));
  expect(screen.getByTestId('repair-camera-grid-a1')).toBeTruthy();
  expect(screen.queryByTestId('mock-camera-view')).toBeNull();

  const list = screen.UNSAFE_getAllByType(FlatList)[0];
  await act(async () => { list.props.onEndReached(); });
  expect(mockGetAssetsAsync).toHaveBeenLastCalledWith(expect.objectContaining({ after: 'a2' }));
  expect(screen.getByTestId('repair-camera-grid-a3')).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-grid-a3')); });
  expect(screen.getByText('Which photo is this?')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-retake')); });
  expect(screen.getByTestId('repair-camera-grid-a3')).toBeTruthy();

  fireEvent.press(screen.getByTestId('repair-camera-gallery-back'));
  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
});

test('a failed capture shows a message and keeps the camera open', async () => {
  mockTakePictureAsync.mockRejectedValueOnce(new Error('camera busy'));
  const { onPicked } = await renderCamera();

  await act(async () => { fireEvent.press(screen.getByTestId('repair-camera-shutter')); });
  expect(screen.getByText('Could not take the photo. Try again.')).toBeTruthy();
  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();
  expect(onPicked).not.toHaveBeenCalled();
});

test('denied camera access offers Settings when it can no longer be asked for; denied photo access offers a retry', async () => {
  mockCameraPermission = { granted: false, canAskAgain: false, status: 'denied' };
  mockMediaPermission = { granted: false, canAskAgain: true, accessPrivileges: 'none' };
  await renderCamera();

  expect(screen.queryByTestId('mock-camera-view')).toBeNull();
  expect(screen.queryByTestId('repair-camera-shutter')).toBeNull();
  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('repair-camera-allow'));
  expect(mockOpenSettings).toHaveBeenCalledTimes(1);

  // Photo access was asked for once on open; the strip stays empty until granted.
  expect(mockRequestMediaPermission).toHaveBeenCalledTimes(1);
  expect(mockGetAssetsAsync).not.toHaveBeenCalled();
  expect(screen.queryByTestId('repair-camera-recent-a1')).toBeNull();
});

test('camera access that can still be asked for is requested on open and the viewfinder appears once granted', async () => {
  mockCameraPermission = { granted: false, canAskAgain: true, status: 'undetermined' };
  mockRequestCameraPermission.mockImplementationOnce(async () => {
    mockCameraPermission = { granted: true, canAskAgain: true, status: 'granted' };
    return mockCameraPermission;
  });
  const { rerender } = await renderCamera();
  expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
  // The photo-library request waits for the camera dialog to settle.
  expect(mockGetCameraPermission.mock.invocationCallOrder[0]).toBeLessThan(mockGetAssetsAsync.mock.invocationCallOrder[0]);
  expect(mockRequestCameraPermission.mock.invocationCallOrder[0]).toBeLessThan(mockGetAssetsAsync.mock.invocationCallOrder[0]);

  // The hook re-renders the component with the new response.
  rerender(<RepairPhotoCamera visible kinds={KINDS} onClose={jest.fn()} onPicked={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByTestId('mock-camera-view')).toBeTruthy();

  // The denied-photos pill retries the media request rather than dead-ending.
  expect(screen.queryByTestId('repair-camera-allow-photos')).toBeNull();
});

test('returning from Settings re-reads the camera permission and retries denied photo access', async () => {
  const { AppState } = require('react-native');
  const listeners: Array<(s: string) => void> = [];
  const addSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, fn: (s: string) => void) => {
    listeners.push(fn);
    return { remove: jest.fn() };
  }) as any);
  mockCameraPermission = { granted: false, canAskAgain: false, status: 'denied' };
  mockMediaPermission = { granted: false, canAskAgain: false, accessPrivileges: 'none' };
  await renderCamera();
  expect(mockGetAssetsAsync).not.toHaveBeenCalled();

  mockCameraPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockMediaPermission = { granted: true, canAskAgain: true, accessPrivileges: 'all' };
  await act(async () => { listeners.forEach((fn) => fn('active')); });
  expect(mockGetCameraPermission).toHaveBeenCalledTimes(2);
  // Photo access is only re-read, never re-requested, on foreground.
  expect(mockRequestMediaPermission).not.toHaveBeenCalled();
  expect(mockGetAssetsAsync).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('repair-camera-recent-a1')).toBeTruthy();
  addSpy.mockRestore();
});
