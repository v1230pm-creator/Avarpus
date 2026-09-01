import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const driveBackupConnectionsTable = pgTable(
  "drive_backup_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    googleSubject: text("google_subject").notNull(),
    email: text("email").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    scopes: text("scopes").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("drive_backup_connections_user_unique").on(table.userId),
    index("drive_backup_connections_google_subject_idx").on(table.googleSubject),
  ],
);

export const driveBackupSettingsTable = pgTable(
  "drive_backup_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    automaticFrequency: text("automatic_frequency").notNull().default("never"),
    allowCellular: boolean("allow_cellular").notNull().default(true),
    includeVideos: boolean("include_videos").notNull().default(true),
    encryptionEnabled: boolean("encryption_enabled").notNull().default(false),
    recoveryPasswordSalt: text("recovery_password_salt"),
    recoveryPasswordVerifier: text("recovery_password_verifier"),
    uploadLeaseHash: text("upload_lease_hash"),
    uploadLeaseExpiresAt: timestamp("upload_lease_expires_at", { withTimezone: true }),
    backupFileId: text("backup_file_id"),
    lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
    lastBackupSizeBytes: text("last_backup_size_bytes"),
    lastError: text("last_error"),
    nextBackupAt: timestamp("next_backup_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("drive_backup_settings_user_unique").on(table.userId),
    index("drive_backup_settings_next_backup_idx").on(table.nextBackupAt),
  ],
);

export const driveBackupOauthStatesTable = pgTable(
  "drive_backup_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("drive_backup_oauth_states_expires_idx").on(table.expiresAt)],
);

export type DbDriveBackupConnection = typeof driveBackupConnectionsTable.$inferSelect;
export type DbDriveBackupSettings = typeof driveBackupSettingsTable.$inferSelect;