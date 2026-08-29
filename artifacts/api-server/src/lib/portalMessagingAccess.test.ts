import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { customerPortalAllowed } from "./customerPortal";
import { dealerPortalAllowed } from "./dealerPortal";

function req(method: string, path: string): Request {
  return { method, path } as Request;
}

describe("restricted-account messaging allowlists", () => {
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
      expect(allowed(req("POST", "/chat/rooms"))).toBe(true);
      expect(allowed(req("GET", `/chat/rooms/${roomId}/messages`))).toBe(true);
      expect(allowed(req("POST", `/chat/rooms/${roomId}/messages`))).toBe(true);
      expect(allowed(req("GET", `/chat/rooms/${roomId}/messages/${messageId}/media`))).toBe(true);
    });
  }

  it("keeps unrelated business endpoints closed", () => {
    expect(customerPortalAllowed(req("GET", "/inventory"))).toBe(false);
    expect(dealerPortalAllowed(req("GET", "/inventory"))).toBe(false);
  });
});