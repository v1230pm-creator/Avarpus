import { describe, expect, it } from "vitest";
import {
  createRecoveryPasswordConfig,
  decryptBackupArchive,
  encryptBackupArchive,
  verifyRecoveryPassword,
} from "./driveBackup";

describe("Drive backup recovery-password encryption", () => {
  it("stores a verifier that accepts only the recovery password", () => {
    const password = "correct horse battery staple";
    const config = createRecoveryPasswordConfig(password);

    expect(config.salt).not.toContain(password);
    expect(config.verifier).not.toContain(password);
    expect(verifyRecoveryPassword(password, config.salt, config.verifier)).toBe(true);
    expect(
      verifyRecoveryPassword("wrong recovery password", config.salt, config.verifier),
    ).toBe(false);
  });

  it("removes plaintext chat and media content from the encrypted upload archive", () => {
    const password = "a long recovery password";
    const config = createRecoveryPasswordConfig(password);
    const plaintext = Buffer.from(
      JSON.stringify({
        format: "avarpus-chat-backup",
        rooms: [
          {
            name: "Private room",
            messages: [
              {
                body: "Plaintext private message",
                media: { data: "cGxhaW50ZXh0LW1lZGlhLWJ5dGVz" },
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const encrypted = encryptBackupArchive(plaintext, password, config.salt);
    const uploadedText = encrypted.toString("utf8");

    expect(uploadedText).not.toContain("Private room");
    expect(uploadedText).not.toContain("Plaintext private message");
    expect(uploadedText).not.toContain("cGxhaW50ZXh0LW1lZGlhLWJ5dGVz");
    expect(decryptBackupArchive(encrypted, password)).toEqual(plaintext);
    expect(() => decryptBackupArchive(encrypted, "wrong recovery password")).toThrow();
  });
});