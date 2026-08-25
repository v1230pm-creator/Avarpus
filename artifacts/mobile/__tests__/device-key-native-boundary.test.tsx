describe('Android device key native boundary', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('fails closed in Expo Go instead of storing or generating a JavaScript private key', async () => {
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: jest.fn(() => null),
    }));

    const deviceKey = require('@/utils/deviceKey') as typeof import('@/utils/deviceKey');
    expect(deviceKey.hasNativeDeviceKeySupport()).toBe(false);
    await expect(deviceKey.createOrReadDeviceKey('android-device-1')).resolves.toBeNull();
    await expect(
      deviceKey.signWithDeviceKey(`AVP-${'a'.repeat(64)}`, 'android-device-1'),
    ).resolves.toBeNull();
  });

  it('uses the custom module for public-key creation and signing when a custom Android build provides it', async () => {
    const nativeModule = {
      getOrCreateKeyPair: jest.fn().mockResolvedValue({
        publicKey: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
        algorithm: 'RSA-SHA256',
      }),
      signChallenge: jest.fn().mockResolvedValue('signature-base64'),
    };
    jest.doMock('expo', () => ({
      requireOptionalNativeModule: jest.fn(() => nativeModule),
    }));

    const deviceKey = require('@/utils/deviceKey') as typeof import('@/utils/deviceKey');
    const challenge = `AVP-${'b'.repeat(64)}`;
    await expect(deviceKey.createOrReadDeviceKey('android-device-2')).resolves.toEqual({
      publicKey: '-----BEGIN PUBLIC KEY-----\nkey\n-----END PUBLIC KEY-----',
      algorithm: 'RSA-SHA256',
    });
    await expect(deviceKey.signWithDeviceKey(challenge, 'android-device-2')).resolves.toBe('signature-base64');

    expect(nativeModule.getOrCreateKeyPair).toHaveBeenCalledWith('android-device-2');
    expect(nativeModule.signChallenge).toHaveBeenCalledWith(challenge, 'android-device-2');
  });
});