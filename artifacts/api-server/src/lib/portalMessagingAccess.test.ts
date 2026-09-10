import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { customerPortalAllowed } from "./customerPortal";
import { dealerPortalAllowed } from "./dealerPortal";
import customerPortalContract from "./customerPortalContract.json";
import dealerPortalContract from "./dealerPortalContract.json";
import {
  customerPortalProfile,
  dealerPortalProfile,
  validatePortalContract,
  type PortalContract,
  type PortalContractProfile,
} from "./portalContractValidator.mjs";

function req(method: string, path: string): Request {
  return { method, path } as Request;
}

describe("restricted-account messaging allowlists", () => {
  const contracts = [
    ["Customer", customerPortalContract, customerPortalProfile],
    ["Dealer", dealerPortalContract, dealerPortalProfile],
  ] as const;

  it.each(contracts)("%s families declare valid isolation coverage", (_portal, contract, profile) => {
    expect(() => validatePortalContract(contract, profile)).not.toThrow();
  });

  it.each(contracts)("%s contracts reject unknown and empty families", (portal, contract, profile) => {
    const unknown = structuredClone(contract) as PortalContract;
    unknown.rules[0].family = "unknown-family";
    expect(() => validatePortalContract(unknown, profile)).toThrow(
      `${portal} portal contract: rule references unknown family: unknown-family`,
    );

    const empty = structuredClone(contract) as PortalContract;
    empty.rules = empty.rules.filter((rule) => rule.family !== empty.families[0].id);
    expect(() => validatePortalContract(empty, profile)).toThrow(
      `${portal} portal contract: family has no allowlist rules: ${empty.families[0].id}`,
    );
  });

  it.each(contracts)("%s contracts reject conflicting coverage modes", (portal, contract, profile) => {
    const conflicting = structuredClone(contract) as PortalContract;
    const family = conflicting.families.find((candidate) =>
      portal === "Customer" ? "isolationProbe" in candidate : "inactiveProbe" in candidate
    );
    expect(family).toBeDefined();
    Object.assign(
      family!,
      portal === "Customer"
        ? { isolationExempt: "This deliberately conflicts with the configured isolation probe." }
        : { inactiveDealerExempt: true },
    );
    expect(() => validatePortalContract(conflicting, profile)).toThrow(
      `${portal} portal contract: family needs exactly one coverage mode: ${family!.id}`,
    );
  });

  it.each(contracts)("%s contracts reject unsupported probes", (portal, contract, profile) => {
    const unsupported = structuredClone(contract) as PortalContract;
    const family = unsupported.families.find((candidate) =>
      portal === "Customer" ? "isolationProbe" in candidate : "inactiveProbe" in candidate
    );
    expect(family).toBeDefined();
    if (portal === "Customer") family!.isolationProbe = "not-supported";
    else family!.inactiveProbe = { method: "TRACE", path: "not-absolute" };
    expect(() => validatePortalContract(unsupported, profile as PortalContractProfile)).toThrow(
      `${portal} portal contract: unsupported probe for family`,
    );
  });

  it("keeps customer auth self-service explicit without opening registration", () => {
    expect(customerPortalAllowed(req("GET", "/auth/me"))).toBe(true);
    expect(customerPortalAllowed(req("GET", "/auth/sessions"))).toBe(true);
    expect(customerPortalAllowed(req("POST", "/auth/logout"))).toBe(true);
    expect(customerPortalAllowed(req("POST", "/auth/register"))).toBe(false);
    expect(customerPortalAllowed(req("POST", "/auth/request-otp"))).toBe(false);
  });

  it("allows customer Profile image uploads without opening generic storage", () => {
    expect(customerPortalAllowed(req("POST", "/storage/profiles/upload-url"))).toBe(true);
    expect(customerPortalAllowed(req("GET", "/storage/objects/arbitrary"))).toBe(false);
  });

  for (const [label, allowed] of [
    ["customer", customerPortalAllowed],
    ["dealer portal", dealerPortalAllowed],
  ] as const) {
    it(`allows ${label} notification inbox and read markers`, () => {
      expect(allowed(req("GET", "/notifications"))).toBe(true);
      expect(allowed(req("POST", "/notifications/read"))).toBe(true);
    });

    it(`allows ${label} membership-scoped direct-chat endpoints`, () => {
      const roomId = "11111111-1111-4111-8111-111111111111";
      const messageId = "22222222-2222-4222-8222-222222222222";
      expect(allowed(req("POST", "/chat/contacts/match"))).toBe(true);
      expect(allowed(req("GET", "/chat/rooms"))).toBe(true);
      expect(allowed(req("GET", "/chat/rooms/archived"))).toBe(true);
      expect(allowed(req("POST", "/chat/rooms"))).toBe(true);
      expect(allowed(req("PATCH", `/chat/rooms/${roomId}/preferences`))).toBe(true);
      expect(allowed(req("GET", `/chat/rooms/${roomId}`))).toBe(true);
      expect(allowed(req("GET", `/chat/rooms/${roomId}/messages`))).toBe(true);
      expect(allowed(req("POST", `/chat/rooms/${roomId}/messages`))).toBe(true);
      expect(allowed(req("POST", `/chat/rooms/${roomId}/upload-url`))).toBe(true);
      expect(allowed(req("GET", `/chat/rooms/${roomId}/messages/${messageId}/media`))).toBe(true);
    });
  }

  it("keeps unrelated business endpoints closed", () => {
    expect(customerPortalAllowed(req("GET", "/inventory"))).toBe(false);
    expect(dealerPortalAllowed(req("GET", "/inventory"))).toBe(false);
  });

  it("keeps the customer repair portal read-only", () => {
    expect(customerPortalAllowed(req("GET", "/repairs"))).toBe(true);
    expect(customerPortalAllowed(req("POST", "/repairs"))).toBe(false);
  });
});
