import { db, usersTable } from "@workspace/db";
import { hashPassword } from "./authUtils";
import { logger } from "./logger";

// Mirrors the app's original demo staff so existing logins keep working,
// but with hashed passwords in the database.
const SEED_USERS = [
  { name: "Super Admin", email: "superadmin@vmc.com", mobile: "9999999999", role: "super_admin", designation: "Super Administrator", joinDate: "2024-01-01", password: "Admin@123" },
  { name: "Rajesh Kumar", email: "dealer@vmc.com", mobile: "9876543210", role: "dealer", designation: "Owner / Dealer", joinDate: "2024-01-15", password: "Dealer@123" },
  { name: "Priya Sharma", email: "reception@vmc.com", mobile: "9876543211", role: "reception", designation: "Reception Staff", joinDate: "2024-02-01", password: "Staff@123" },
  { name: "Arjun Singh", email: "tech@vmc.com", mobile: "9876543212", role: "technician", designation: "Senior Technician", joinDate: "2024-02-10", password: "Tech@123" },
  { name: "Meena Patel", email: "store@vmc.com", mobile: "9876543213", role: "store_manager", designation: "Store Manager", joinDate: "2024-03-01", password: "Store@123" },
  { name: "Suresh Joshi", email: "accounts@vmc.com", mobile: "9876543214", role: "accountant", designation: "Accountant", joinDate: "2024-03-15", password: "Accts@123" },
];

export async function seedUsersIfEmpty(): Promise<void> {
  // Demo users are only seeded when explicitly enabled. Production flow is:
  // dealers register publicly, then create their own staff in-app.
  if (process.env.SEED_DEMO_USERS !== "true") return;
  const existing = await db.select({ id: usersTable.id }).from(usersTable).limit(1);
  if (existing.length > 0) return;
  await db.insert(usersTable).values(
    SEED_USERS.map((u) => ({
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      passwordHash: hashPassword(u.password),
      role: u.role,
      isActive: true,
      designation: u.designation,
      joinDate: u.joinDate,
    })),
  );
  logger.info("Seeded initial staff users");
}
