import { customFetch } from "./custom-fetch";

export type ShopSummary = {
  id: string;
  businessName: string;
  address?: string | null;
  businessEmail?: string | null;
  businessEmailVerified?: boolean;
  role: string;
  staffId?: string | null;
  permissions?: Record<string, unknown>;
};

export type ShopMeResponse = {
  activeShopId: string | null;
  backupDetected: boolean;
  shop: ShopSummary | null;
  memberships: Array<Pick<ShopSummary, "id" | "businessName" | "role" | "staffId">>;
};

export function shopMe(): Promise<ShopMeResponse> {
  return customFetch<ShopMeResponse>("/api/shop/me", { responseType: "json" });
}

export function shopSetupRequest(data: {
  businessName: string;
  email: string;
  address: string;
  gstNumber?: string;
}): Promise<{ message: string; email: string }> {
  return customFetch("/api/shop/setup/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopSetupVerify(data: {
  email: string;
  code: string;
}): Promise<{ message: string; shop: ShopSummary; user: unknown }> {
  return customFetch("/api/shop/setup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopInvite(data: {
  mobile: string;
  role: "reception" | "technician" | "store_manager" | "accountant";
}): Promise<{ staffId: string; claimCode: string; status: string }> {
  return customFetch("/api/shop/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopClaim(data: {
  staffId: string;
  claimCode: string;
}): Promise<{ message: string; shop: ShopSummary; user: unknown }> {
  return customFetch("/api/shop/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopSwitch(shopId: string): Promise<{ shop: ShopSummary; user: unknown }> {
  return customFetch("/api/shop/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shopId }),
    responseType: "json",
  });
}

export function shopRecoveryRequest(shopId: string): Promise<{ message: string; maskedEmail: string }> {
  return customFetch("/api/shop/recovery/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shopId }),
    responseType: "json",
  });
}

export function shopRecoveryVerify(data: {
  shopId: string;
  email: string;
  code: string;
}): Promise<{ message: string; shop: ShopSummary; user: unknown }> {
  return customFetch("/api/shop/recovery/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}