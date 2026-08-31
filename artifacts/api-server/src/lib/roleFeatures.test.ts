import { describe, expect, it } from "vitest";
import {
  CANONICAL_PERMISSIONS,
  canonicalPermissionsForFeatures,
} from "./roleFeatures";

describe("canonical permission vocabulary", () => {
  it("derives permissions from legacy features without changing their vocabulary", () => {
    expect(canonicalPermissionsForFeatures("reception", {
      repairs: true,
      repairs_update: true,
      payments: false,
      reports: false,
    })).toMatchObject({
      VIEW_REPAIR: true,
      EDIT_REPAIR: true,
      VIEW_KHATA: false,
      EDIT_KHATA: false,
      VIEW_BUSINESS_REPORTS: false,
      MANAGE_STAFF: false,
    });
  });

  it("keeps owner roles unrestricted and customers without business permissions", () => {
    expect(canonicalPermissionsForFeatures("dealer", {})).toEqual(
      Object.fromEntries(CANONICAL_PERMISSIONS.map((permission) => [permission, true])),
    );
    expect(canonicalPermissionsForFeatures("customer", { repairs: true })).toEqual(
      Object.fromEntries(CANONICAL_PERMISSIONS.map((permission) => [permission, false])),
    );
  });

  it("maps read-only dealer portal repair access without granting repair editing", () => {
    expect(canonicalPermissionsForFeatures("dealer_staff", { portal_repairs: true })).toMatchObject({
      VIEW_REPAIR: true,
      EDIT_REPAIR: false,
    });
  });
});