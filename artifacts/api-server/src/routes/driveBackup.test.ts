import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  driveBackupConnectionsTable,
  driveBackupOauthStatesTable,
  driveBackupSettingsTable,
  usersTable,
} from "@workspace/db";

process.env.GOOGLE_BACKUP_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_BACKUP_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_BACKUP_REDIRECT_URI =
  "https://api.avarpus.com/api/drive-backup/oauth/callback";
process.env.SESSION_SECRET ??= "drive-backup-test-session-secret";

const { default: app } = await import("../app");
const { createSession } = await import("../lib/authUtils");
const { encryptRefreshToken } = await import("../lib/driveBackup");

const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let userId: string;
let token: string;

beforeAll(async () => {
  const [user] = await db
    .insert(usersTable)
    .values({
      name: "Drive Backup Test",
      email: `drive-backup-${run}@example.test`,
      mobile: `8${Date.now().toString().slice(-9)}`,
      role: "customer_user",
      isActive: true,
    })
    .returning({ id: usersTable.id });
  userId = user.id;
  token = await createSession(userId, false, "drive-backup-test");
});

afterAll(async () => {
  if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
});

describe("Drive backup routes", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/drive-backup");
    expect(response.status).toBe(401);
  });

  it("creates default settings for a personal account without a shop", async () => {
    const response = await request(app)
      .get("/api/drive-backup")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      connected: false,
      email: null,
      quota: null,
      automaticFrequency: "never",
      allowCellular: false,
      includeVideos: false,
      encryptionEnabled: false,
      backupDue: false,
    });
  });

  it("persists validated automatic backup settings", async () => {
    const response = await request(app)
      .patch("/api/drive-backup/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({
        automaticFrequency: "weekly",
        allowCellular: true,
        includeVideos: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      connected: false,
      automaticFrequency: "never",
      allowCellular: true,
      includeVideos: true,
    });
    expect(response.body.nextBackupAt).toBeNull();

    const [stored] = await db
      .select()
      .from(driveBackupSettingsTable)
      .where(eq(driveBackupSettingsTable.userId, userId));
    expect(stored?.automaticFrequency).toBe("never");
  });

  it("rejects a backup until the user connects Google Drive", async () => {
    const response = await request(app)
      .post("/api/drive-backup/prepare")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("Google account");
  });

  it("issues a short-lived OAuth state bound to the authenticated user", async () => {
    const response = await request(app)
      .get("/api/drive-backup/oauth/start")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    const url = new URL(response.body.url);
    const state = url.searchParams.get("state");
    expect(url.hostname).toBe("accounts.google.com");
    expect(url.searchParams.get("scope")).toContain(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(state).toBeTruthy();

    const [stored] = await db
      .select()
      .from(driveBackupOauthStatesTable)
      .where(
        eq(
          driveBackupOauthStatesTable.stateHash,
          createHash("sha256").update(state!).digest("hex"),
        ),
      );
    expect(stored?.userId).toBe(userId);
    expect(stored?.stateHash).not.toBe(state);
    expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("fails closed for an unknown OAuth callback state", async () => {
    const response = await request(app)
      .get("/api/drive-backup/oauth/callback")
      .query({ code: "not-a-real-code", state: "unknown-state" });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("avarpus://google-backup?status=error");
  });

  it("does not accept recovery passwords at any server endpoint", async () => {
    const response = await request(app)
      .post("/api/drive-backup/encryption")
      .set("Authorization", `Bearer ${token}`)
      .send({
        recoveryPassword: "correct horse battery staple",
        recoveryPasswordConfirmation: "a different long password",
      });

    expect(response.status).toBe(404);
  });

  it("rejects malformed client-side encrypted backup completions", async () => {
    const response = await request(app)
      .post("/api/drive-backup/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({
        fileId: "drive-file",
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.field).toBe("sizeBytes");
  });
});