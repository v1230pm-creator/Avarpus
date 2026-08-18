import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

// ── OTA app updates (global, not shop-scoped) ───────────────────────────────
// APK releases published by a super_admin and downloadable from inside the
// app. This table is strictly additive to the schema: the OTA system never
// touches business data, and updates are never auto-installed.

export const appUpdatesTable = pgTable("app_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull(), // e.g. "1.2.0"
  buildNumber: integer("build_number").notNull(), // authoritative comparison key
  releaseDate: text("release_date"), // ISO date (YYYY-MM-DD)
  apkPath: text("apk_path"), // /objects/app-updates/<uuid>
  apkSize: integer("apk_size"), // bytes, computed server-side
  checksum: text("checksum"), // SHA-256 hex, computed server-side
  updateType: text("update_type").notNull().default("optional"), // optional | recommended | critical
  minAndroidVersion: text("min_android_version"),
  releaseNotes: jsonb("release_notes"), // [{ category, items: [] }] or string[]
  screenshots: jsonb("screenshots"), // string[] of object paths/URLs
  demoVideoUrl: text("demo_video_url"),
  status: text("status").notNull().default("draft"), // draft | published | unpublished | archived
  downloadCount: integer("download_count").notNull().default(0),
  checkCount: integer("check_count").notNull().default(0), // update checks recorded against this release
  createdBy: uuid("created_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  publishedBy: uuid("published_by").references(() => usersTable.id, {
    onDelete: "set null",
  }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type DbAppUpdate = typeof appUpdatesTable.$inferSelect;
