import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatsPage } from "../src/pages/chats";

const mocks = vi.hoisted(() => ({
  blockMutate: vi.fn(),
  unblockMutate: vi.fn(),
  reportMutate: vi.fn(),
  toast: vi.fn(),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@workspace/api-client-react", () => ({
  getChatMessagesListQueryKey: (roomId: string) => [
    `/api/chat/rooms/${roomId}/messages`,
  ],
  getChatRoomsGetQueryKey: (roomId: string) => [`/api/chat/rooms/${roomId}`],
  getChatRoomsListQueryKey: () => ["/api/chat/rooms"],
  useChatRoomsList: () => ({
    data: {
      rooms: [
        {
          id: "room-1",
          name: "Alice",
          kind: "direct",
          scope: "global_direct",
          shopId: null,
          isArchived: false,
          createdAt: "2026-01-01T10:00:00Z",
        },
      ],
    },
    isLoading: false,
  }),
  useChatRoomsGet: () => ({
    data: {
      room: {
        id: "room-1",
        name: "Alice",
        kind: "direct",
        scope: "global_direct",
        shopId: null,
        isBlocked: false,
        blockedByMe: false,
        isArchived: false,
        createdAt: "2026-01-01T10:00:00Z",
      },
    },
  }),
  useChatMessagesList: () => ({
    data: {
      messages: [
        {
          id: "message-1",
          roomId: "room-1",
          shopId: null,
          senderId: "peer-1",
          senderName: "Alice",
          kind: "text",
          body: "Existing message",
          createdAt: "2026-01-01T10:00:00Z",
        },
      ],
      hasMore: false,
    },
    isLoading: false,
  }),
  useChatRoomsBlock: () => ({ mutate: mocks.blockMutate, isPending: false }),
  useChatRoomsUnblock: () => ({ mutate: mocks.unblockMutate, isPending: false }),
  useChatReportsCreate: () => ({ mutate: mocks.reportMutate, isPending: false }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "me", role: "customer" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

let root: Root;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  mocks.blockMutate.mockReset();
  mocks.unblockMutate.mockReset();
  mocks.reportMutate.mockReset();
  mocks.toast.mockReset();
  root = createRoot(document.getElementById("root")!);
});

afterEach(() => {
  act(() => root.unmount());
});

describe("web chat safety controls", () => {
  it("renders existing history and invokes block and report mutations", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatsPage />
        </QueryClientProvider>,
      );
    });

    expect(document.body.textContent).toContain("Existing message");
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
    const blockButton = buttons.find((button) => button.textContent === "Block");
    const reportButton = buttons.find((button) => button.textContent === "Report");
    expect(blockButton).toBeDefined();
    expect(reportButton).toBeDefined();

    await act(async () => blockButton?.click());
    expect(mocks.blockMutate).toHaveBeenCalledWith(
      { roomId: "room-1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );

    await act(async () => reportButton?.click());
    const details = document.querySelector<HTMLTextAreaElement>("textarea");
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      valueSetter?.call(details, "Repeated unwanted messages");
      details?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submitButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Submit report",
    );
    await act(async () => submitButton?.click());

    expect(mocks.reportMutate).toHaveBeenCalledWith(
      {
        roomId: "room-1",
        data: {
          reason: "spam",
          details: "Repeated unwanted messages",
          clientRequestId: expect.any(String),
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    const firstRequestId = mocks.reportMutate.mock.calls[0][0].data.clientRequestId;
    await act(async () => {
      mocks.reportMutate.mock.calls[0][1].onError(new Error("ambiguous network failure"));
      submitButton?.click();
    });
    expect(mocks.reportMutate.mock.calls[1][0].data.clientRequestId).toBe(firstRequestId);
  });
});