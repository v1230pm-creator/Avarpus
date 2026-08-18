import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { shopsTable } from "./auth";

// Per-shop, per-role feature toggles. The shop owner (dealer / super_admin)
// edits these from the mobile app's "Staff Permissions" screen; missing rows
// (or missing keys inside `features`) fall back to the server-side defaults in
// the API layer, so a shop with no rows behaves exactly as before.
export const roleFeatureSettingsTable = pgTable(
  "role_feature_settings",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shopsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    // { [featureKey]: boolean } — only known keys are ever persisted.
    features: jsonb("features").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shopId, t.role] })],
);
