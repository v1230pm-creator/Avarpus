import { customFetch } from "./custom-fetch";

import type {
  ShopClaimInput,
  ShopInvitationInput,
  ShopInvitationResult,
  ShopMeResponse,
  ShopRecoveryRequestInput,
  ShopRecoveryRequestResult,
  ShopRecoveryVerifyInput,
  ShopSetupRequestInput,
  ShopSetupRequestResult,
  ShopSetupVerifyInput,
  ShopSummary,
  ShopSwitchInput,
  ShopSwitchResult,
  ShopUserResult,
} from "./generated/api.schemas";

export type { ShopMeResponse, ShopSummary };

export function shopMe(): Promise<ShopMeResponse> {
  return customFetch<ShopMeResponse>("/api/shop/me", { responseType: "json" });
}

export function shopSetupRequest(data: ShopSetupRequestInput): Promise<ShopSetupRequestResult> {
  return customFetch("/api/shop/setup/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopSetupVerify(data: ShopSetupVerifyInput): Promise<ShopUserResult> {
  return customFetch("/api/shop/setup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopInvite(data: ShopInvitationInput): Promise<ShopInvitationResult> {
  return customFetch("/api/shop/invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopClaim(data: ShopClaimInput): Promise<ShopUserResult> {
  return customFetch("/api/shop/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopSwitch(shopId: string): Promise<ShopSwitchResult> {
  const data: ShopSwitchInput = { shopId };
  return customFetch("/api/shop/switch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopRecoveryRequest(shopId: string): Promise<ShopRecoveryRequestResult> {
  const data: ShopRecoveryRequestInput = { shopId };
  return customFetch("/api/shop/recovery/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}

export function shopRecoveryVerify(data: ShopRecoveryVerifyInput): Promise<ShopUserResult> {
  return customFetch("/api/shop/recovery/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    responseType: "json",
  });
}