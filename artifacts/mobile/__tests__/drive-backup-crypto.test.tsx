import { webcrypto } from 'node:crypto';
import {
  bytesToBase64,
  decryptDriveBackup,
  encryptDriveBackup,
} from '@/utils/driveBackupCrypto';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

describe('Drive backup client-side encryption', () => {
  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      format: 'avarpus-chat-backup',
      version: 1,
      rooms: [{
        name: 'Private repair chat',
        messages: [{
          body: 'secret customer message',
          media: { data: 'private-media-base64' },
        }],
      }],
    }),
  );

  it('encrypts before upload without exposing plaintext chat or media', () => {
    const encrypted = encryptDriveBackup(
      bytesToBase64(plaintext),
      'correct horse battery staple',
    );
    const uploadedText = new TextDecoder().decode(encrypted.encryptedBytes);

    expect(uploadedText).not.toContain('secret customer message');
    expect(uploadedText).not.toContain('private-media-base64');
    expect(uploadedText).not.toContain('Private repair chat');
    expect(decryptDriveBackup(
      encrypted.encryptedBytes,
      'correct horse battery staple',
      encrypted.salt,
    )).toEqual(plaintext);
  });

  it('cannot recover with the wrong password', () => {
    const encrypted = encryptDriveBackup(
      bytesToBase64(plaintext),
      'correct horse battery staple',
    );
    expect(() => decryptDriveBackup(
      encrypted.encryptedBytes,
      'incorrect password value',
      encrypted.salt,
    )).toThrow(/incorrect|damaged/i);
  });
});