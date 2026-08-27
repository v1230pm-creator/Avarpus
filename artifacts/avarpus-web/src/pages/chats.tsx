import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getChatMessagesListQueryKey,
  getChatRoomsGetQueryKey,
  getChatRoomsListQueryKey,
  useChatMessagesList,
  useChatReportsCreate,
  useChatRoomsBlock,
  useChatRoomsGet,
  useChatRoomsList,
  useChatRoomsUnblock,
} from "@workspace/api-client-react";
import type { ChatReportReason } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export function ChatsPage() {
  const { data, isLoading } = useChatRoomsList();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<ChatReportReason>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const pendingReportRef = useRef<{ fingerprint: string; id: string } | null>(null);
  // The server remains the authorization authority. This client-side filter
  // additionally keeps a customer landing free of dealer/staff room types if
  // a mixed room list is ever returned.
  const rooms =
    user?.role === "customer"
      ? (data?.rooms ?? []).filter(
          (room: any) => room.kind === "customer" || room.kind === "direct",
        )
      : data?.rooms ?? [];
  const activeRoomId =
    selectedRoomId && rooms.some((room: any) => room.id === selectedRoomId)
      ? selectedRoomId
      : rooms[0]?.id ?? null;
  const { data: roomData } = useChatRoomsGet(activeRoomId ?? "", {
    query: {
      enabled: Boolean(activeRoomId),
      queryKey: getChatRoomsGetQueryKey(activeRoomId ?? ""),
    },
  });
  const { data: messagesData, isLoading: messagesLoading } = useChatMessagesList(
    activeRoomId ?? "",
    undefined,
    {
      query: {
        enabled: Boolean(activeRoomId),
        queryKey: getChatMessagesListQueryKey(activeRoomId ?? ""),
      },
    },
  );
  const room = roomData?.room;
  const messages = useMemo(
    () => [...(messagesData?.messages ?? [])].reverse(),
    [messagesData?.messages],
  );
  const blockMutation = useChatRoomsBlock();
  const unblockMutation = useChatRoomsUnblock();
  const reportMutation = useChatReportsCreate();

  const refreshSafetyState = async () => {
    if (!activeRoomId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getChatRoomsGetQueryKey(activeRoomId) }),
      queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
    ]);
  };

  const toggleBlock = () => {
    if (!activeRoomId || !room) return;
    const mutation = room.blockedByMe ? unblockMutation : blockMutation;
    mutation.mutate(
      { roomId: activeRoomId },
      {
        onSuccess: async () => {
          await refreshSafetyState();
          toast({
            title: room.blockedByMe ? "Contact unblocked" : "Contact blocked",
            description: room.blockedByMe
              ? "Messages and calls are available again."
              : "Existing history remains readable, but messages and calls are disabled.",
          });
        },
        onError: (err: any) =>
          toast({
            title: "Could not update block",
            description: err?.data?.message ?? err?.message ?? "Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

  const submitReport = () => {
    if (!activeRoomId) return;
    const fingerprint = `${activeRoomId}:${reportReason}:${reportDetails.trim()}`;
    const clientRequestId =
      pendingReportRef.current?.fingerprint === fingerprint
        ? pendingReportRef.current.id
        : crypto.randomUUID();
    pendingReportRef.current = { fingerprint, id: clientRequestId };
    reportMutation.mutate(
      {
        roomId: activeRoomId,
        data: {
          clientRequestId,
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          if (pendingReportRef.current?.id === clientRequestId) {
            pendingReportRef.current = null;
          }
          setShowReport(false);
          setReportDetails("");
          toast({
            title: "Report submitted",
            description: "Thank you. The report has been saved for review.",
          });
        },
        onError: (err: any) =>
          toast({
            title: "Could not submit report",
            description: err?.data?.message ?? err?.message ?? "Please try again.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
          <p className="text-muted-foreground">
            {user?.role === "customer"
              ? "Your customer and direct conversations."
              : "Customer and internal conversations."}
          </p>
        </div>
      </div>
      
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading chats...</div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 p-8 text-center border-dashed border-2 m-4 rounded-xl">
            <h3 className="text-lg font-semibold mb-1">No active conversations</h3>
            <p className="text-muted-foreground max-w-sm">When customers message you from their portal, they will appear here.</p>
          </div>
        ) : (
          <div className="flex h-full">
            <div className="w-1/3 border-r flex flex-col">
              <div className="p-4 border-b font-medium">Conversations</div>
              <div className="flex-1 overflow-y-auto">
                {rooms.map((room: any) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      setSelectedRoomId(room.id);
                      setShowReport(false);
                      pendingReportRef.current = null;
                    }}
                    className={`w-full p-4 border-b text-left hover:bg-muted/50 ${
                      room.id === activeRoomId ? "bg-muted/70" : ""
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-semibold text-sm truncate">{room.name}</h4>
                      {room.lastMessageAt && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                          {format(new Date(room.lastMessageAt), 'MMM d')}
                        </span>
                      )}
                    </div>
                    {room.lastMessageBody && (
                      <p className="text-xs text-muted-foreground truncate">{room.lastMessageBody}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-w-0 bg-muted/20 flex flex-col">
              {room ? (
                <>
                  <div className="border-b bg-card px-5 py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{room.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {room.isBlocked
                          ? "Blocked · existing history remains readable"
                          : room.scope === "global_direct"
                            ? "Global direct conversation"
                            : "Business conversation"}
                      </p>
                    </div>
                    {room.scope === "global_direct" && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowReport((value) => !value)}
                        >
                          Report
                        </Button>
                        {(!room.isBlocked || room.blockedByMe) && (
                          <Button
                            variant={room.blockedByMe ? "outline" : "destructive"}
                            size="sm"
                            onClick={toggleBlock}
                            disabled={blockMutation.isPending || unblockMutation.isPending}
                          >
                            {room.blockedByMe ? "Unblock" : "Block"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {showReport && room.scope === "global_direct" && (
                    <div className="border-b bg-card p-4 space-y-3">
                      <div className="flex gap-3">
                        <label className="text-sm font-medium flex-1">
                          Reason
                          <select
                            className="mt-1 h-10 w-full rounded-md border bg-background px-3"
                            value={reportReason}
                            onChange={(event) =>
                              setReportReason(event.target.value as ChatReportReason)
                            }
                          >
                            <option value="spam">Spam</option>
                            <option value="harassment">Harassment</option>
                            <option value="scam">Scam</option>
                            <option value="inappropriate">Inappropriate content</option>
                            <option value="other">Other</option>
                          </select>
                        </label>
                      </div>
                      <Textarea
                        value={reportDetails}
                        maxLength={1000}
                        onChange={(event) => setReportDetails(event.target.value)}
                        placeholder="Optional details for the review team"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowReport(false);
                            pendingReportRef.current = null;
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={submitReport}
                          disabled={reportMutation.isPending}
                        >
                          Submit report
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    {messagesLoading ? (
                      <p className="text-sm text-muted-foreground">Loading messages...</p>
                    ) : messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No messages yet.</p>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`max-w-[78%] rounded-lg border bg-card px-3 py-2 ${
                            message.senderId === user?.id ? "ml-auto" : ""
                          }`}
                        >
                          <p className="text-xs font-medium">{message.senderName}</p>
                          <p className="text-sm whitespace-pre-wrap break-words">{message.body}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {format(new Date(message.createdAt), "MMM d, h:mm a")}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Select a conversation
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
