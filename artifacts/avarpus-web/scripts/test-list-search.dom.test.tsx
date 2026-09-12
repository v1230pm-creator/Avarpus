/**
 * List pages that filter in the browser must not put the search term in their
 * React Query key: the endpoints take no `q` parameter, so a keyed term makes
 * every keystroke re-fetch the identical full list.
 *
 * Each case renders the real page with the real generated hooks and only the
 * HTTP transport stubbed, types into the search box, and asserts the list
 * endpoint was hit exactly once while the visible rows still narrow down.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomersPage } from "../src/pages/customers";
import { InventoryPage } from "../src/pages/inventory";
import { FinancePage } from "../src/pages/finance";
import { PaymentsPage } from "../src/pages/payments";
import { PurchasesPage } from "../src/pages/purchases";
import { StaffPage } from "../src/pages/staff";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const ISO = "2026-01-05T10:00:00.000Z";

const RESPONSES: Record<string, unknown> = {
  "/api/customers": {
    customers: [
      { id: "c1", name: "Aisha Khan", mobile: "9000000001", email: "aisha@example.com", dueAmount: 0, totalRepairs: 2, createdAt: ISO },
      { id: "c2", name: "Bharat Rao", mobile: "9000000002", email: "bharat@example.com", dueAmount: 0, totalRepairs: 1, createdAt: ISO },
    ],
  },
  "/api/inventory": {
    items: [
      { id: "i1", name: "Aisha Screen", category: "Display", quantity: 4, sellingPrice: 1200 },
      { id: "i2", name: "Bharat Battery", category: "Power", quantity: 7, sellingPrice: 800 },
    ],
  },
  "/api/finance": {
    entries: [
      { id: "f1", type: "income", category: "Aisha", description: "Service income", date: ISO, amount: 500 },
      { id: "f2", type: "expense", category: "Bharat", description: "Rent", date: ISO, amount: 900 },
    ],
  },
  "/api/payments": {
    payments: [
      { id: "p1", repairId: "AISHA-1", kind: "advance", method: "cash", createdAt: ISO, amount: 300 },
      { id: "p2", repairId: "BHARAT-1", kind: "final", method: "upi", createdAt: ISO, amount: 700 },
    ],
  },
  "/api/purchases": {
    purchases: [
      { id: "pu1", invoiceNo: "AISHA-INV", supplier: "North Parts", date: ISO, total: 1500 },
      { id: "pu2", invoiceNo: "BHARAT-INV", supplier: "South Parts", date: ISO, total: 2500 },
    ],
  },
  "/api/staff": {
    staff: [
      { id: "s1", name: "Aisha Khan", designation: "Technician", mobile: "9000000001", email: "aisha@example.com", role: "technician", isActive: true },
      { id: "s2", name: "Bharat Rao", designation: "Manager", mobile: "9000000002", email: "bharat@example.com", role: "manager", isActive: true },
    ],
  },
};

let requestedPaths: string[] = [];
let root: Root;

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  return raw.split("?")[0];
}

beforeEach(() => {
  requestedPaths = [];
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = pathOf(input);
    requestedPaths.push(path);
    const body = RESPONSES[path];
    if (body === undefined) throw new Error(`Unexpected request: ${path}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (document.body.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for "${text}"`);
}

async function typeSearch(text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]');
  if (!input) throw new Error("No search input rendered");
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  // One event per character, exactly like a person typing.
  for (let i = 1; i <= text.length; i += 1) {
    await act(async () => {
      valueSetter?.call(input, text.slice(0, i));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

const CASES: Array<{
  name: string;
  path: string;
  render: () => JSX.Element;
  term: string;
  kept: string;
  dropped: string;
}> = [
  { name: "customers", path: "/api/customers", render: () => <CustomersPage />, term: "Aisha", kept: "Aisha Khan", dropped: "Bharat Rao" },
  { name: "inventory", path: "/api/inventory", render: () => <InventoryPage />, term: "Aisha", kept: "Aisha Screen", dropped: "Bharat Battery" },
  { name: "finance", path: "/api/finance", render: () => <FinancePage />, term: "Aisha", kept: "Service income", dropped: "Rent" },
  { name: "payments", path: "/api/payments", render: () => <PaymentsPage />, term: "AISHA", kept: "AISHA-1", dropped: "BHARAT-1" },
  { name: "purchases", path: "/api/purchases", render: () => <PurchasesPage />, term: "AISHA", kept: "North Parts", dropped: "South Parts" },
  { name: "staff", path: "/api/staff", render: () => <StaffPage />, term: "Aisha", kept: "Technician", dropped: "Manager" },
];

describe("browser-filtered list pages", () => {
  for (const testCase of CASES) {
    it(`${testCase.name} search does not re-fetch the list per keystroke`, async () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });

      await act(async () => {
        root.render(
          <QueryClientProvider client={queryClient}>{testCase.render()}</QueryClientProvider>,
        );
      });

      await waitForText(testCase.dropped);

      const initialRequests = requestedPaths.filter((path) => path === testCase.path).length;
      expect(initialRequests).toBe(1);

      await typeSearch(testCase.term);

      expect(requestedPaths.filter((path) => path === testCase.path).length).toBe(1);
      expect(document.body.textContent).toContain(testCase.kept);
      expect(document.body.textContent).not.toContain(testCase.dropped);
    });
  }
});
