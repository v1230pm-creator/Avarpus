import { gcm } from '@noble/ciphers/aes';
import { utf8ToBytes, bytesToUtf8, concatBytes } from '@noble/ciphers/utils';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

const ITERATIONS = 210_000;
const CONTEXT = utf8ToBytes('avarpus-drive-backup-verifier-v2');

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function keyFor(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(password.normalize('NFKC')), salt, {
    c: ITERATIONS,
    dkLen: 32,
  });
}

export function recoveryVerifier(password: string, saltBase64: string): string {
  const key = keyFor(password, base64ToBytes(saltBase64));
  return bytesToBase64(sha256(concatBytes(key, CONTEXT)));
}

export function encryptDriveBackup(
  archiveBase64: string,
  password: string,
  existingSalt?: string | null,
): { encryptedBytes: Uint8Array; salt: string; verifier: string } {
  const saltBytes = existingSalt ? base64ToBytes(existingSalt) : randomBytes(16);
  const salt = bytesToBase64(saltBytes);
  const key = keyFor(password, saltBytes);
  const iv = randomBytes(12);
  const ciphertext = gcm(key, iv).encrypt(base64ToBytes(archiveBase64));
  const envelope = {
    format: 'avarpus-chat-backup-encrypted',
    version: 2,
    kdf: 'pbkdf2-sha256',
    iterations: ITERATIONS,
    cipher: 'aes-256-gcm',
    salt,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
  return {
    encryptedBytes: utf8ToBytes(JSON.stringify(envelope)),
    salt,
    verifier: bytesToBase64(sha256(concatBytes(key, CONTEXT))),
  };
}

export function decryptDriveBackup(
  encryptedBytes: Uint8Array,
  password: string,
  expectedSalt: string,
): Uint8Array {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(bytesToUtf8(encryptedBytes));
  } catch {
    throw new Error('This backup file is damaged or is not an Avarpus encrypted backup.');
  }
  if (
    envelope.format !== 'avarpus-chat-backup-encrypted' ||
    envelope.version !== 2 ||
    envelope.kdf !== 'pbkdf2-sha256' ||
    envelope.iterations !== ITERATIONS ||
    envelope.cipher !== 'aes-256-gcm' ||
    envelope.salt !== expectedSalt ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string'
  ) {
    throw new Error('This backup file is damaged or uses a different recovery password setup.');
  }
  try {
    return gcm(
      keyFor(password, base64ToBytes(expectedSalt)),
      base64ToBytes(envelope.iv),
    ).decrypt(base64ToBytes(envelope.ciphertext));
  } catch {
    throw new Error('That recovery password is incorrect, or the backup file is damaged.');
  }
}