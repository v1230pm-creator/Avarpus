import { sql } from "drizzle-orm";
import { shopsTable, usersTable } from "@workspace/db";

type Shop = typeof shopsTable.$inferSelect;

// users.role is the legacy compatibility mirror of the active membership; an
// owner membership is represented there as "dealer".
export function mirroredUserRole(membershipRole: string): string {
  return membershipRole === "owner" ? "dealer" : membershipRole;
}

// Fields mirrored onto the users row when a membership becomes the active
// workspace (what /shop/setup writes for the creating owner).
// Owner-only fields (GSTIN printed on documents, the "Owner" designation)
// follow the workspace: they are set when an owner membership is selected and
// cleared again when a staff membership is, so a co-owner of Shop A who also
// works at Shop B never issues B's documents with A's GSTIN.
export function workspaceMirror(shop: Shop, membershipRole: string) {
  return {
    shopId: shop.id,
    role: mirroredUserRole(membershipRole),
    isActive: true,
    businessName: shop.businessName,
    shopAddress: shop.address,
    ...(membershipRole === "owner"
      ? { gstNumber: shop.gstNumber, designation: "Owner" }
      : { gstNumber: null, designation: sql`case when ${usersTable.designation} = 'Owner' then null else ${usersTable.designation} end` }),
  };
}

// What the users row looks like once the account belongs to no workspace at
// all: a plain personal (OTP) account that keeps its chats, calls and status.
// Used when the last remaining membership is removed.
export function clearedWorkspaceMirror() {
  return {
    shopId: null,
    role: "customer",
    businessName: null,
    shopAddress: null,
    gstNumber: null,
    designation: null,
  };
}
