import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  retryDealerPortal: vi.fn(),
}));

let authState: {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { id: string; role: string; needsDisplayName: boolean };
  dealerPortalInactive: boolean;
  canAccess: (feature: string) => boolean;
};

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ...authState,
    logout: mocks.logout,
    retryDealerPortal: mocks.retryDealerPortal,
  }),
}));

vi.mock("@/components/layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/pages/chats", () => ({
  ChatsPage: () => <div>Customer chats</div>,
}));

import { ProtectedRoutes } from "../src/routes";

let root: Root;

function renderRoutes() {
  root.render(
    <Router>
      <ProtectedRoutes />
    </Router>,
  );
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState({}, "", "/portal/repairs");
  mocks.logout.mockReset();
  mocks.retryDealerPortal.mockReset();
  root = createRoot(document.getElementById("root")!);
});

afterEach(() => {
  act(() => root.unmount());
});

describe.each(["dealer_owner", "dealer_staff"])("%s portal recovery", (role) => {
  it("keeps the session, hides portal content, and resumes after Retry", async () => {
    authState = {
      isAuthenticated: true,
      isLoading: false,
      user: { id: `${role}-user`, role, needsDisplayName: false },
      dealerPortalInactive: true,
      canAccess: (feature) => feature === "repairs_portal" || feature === "settings",
    };
    mocks.retryDealerPortal.mockImplementation(async () => {
      authState = { ...authState, dealerPortalInactive: false };
    });

    await act(async () => renderRoutes());

    expect(document.body.textContent).toContain("Dealer portal is inactive");
    expect(document.body.textContent).not.toContain("Repair records for dealer portal accounts");
    expect(document.body.textContent).toContain("Manage account");
    expect(document.body.textContent).toContain("Sign out");

    const retry = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry access",
    );
    await act(async () => retry?.click());
    await act(async () => renderRoutes());

    expect(mocks.retryDealerPortal).toHaveBeenCalledTimes(1);
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe("/portal/repairs");
    expect(document.body.textContent).not.toContain("Dealer portal is inactive");
    expect(document.body.textContent).toContain("Repair records for dealer portal accounts");
  });
});

it("leaves customer portal routing unchanged", async () => {
  window.history.replaceState({}, "", "/chats");
  authState = {
    isAuthenticated: true,
    isLoading: false,
    user: { id: "customer-user", role: "customer", needsDisplayName: false },
    dealerPortalInactive: false,
    canAccess: (feature) => feature === "chat",
  };

  await act(async () => renderRoutes());

  expect(document.body.textContent).toContain("Customer chats");
  expect(document.body.textContent).not.toContain("Dealer portal is inactive");
});