import { useEffect, useRef } from "react";
import { format } from "date-fns";
import {
  type ChatReportQueueItem,
  getChatAdminReportTranscriptQueryKey,
  useChatAdminReportTranscript,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { SectionLoader } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Paperclip } from "lucide-react";

/**
 * Read-only transcript of a reported conversation. Opening it reads two private
 * users' messages, so the server records the access — the wording below tells
 * the operator that before they scroll.
 */
export function TranscriptDialog({
  report,
  onClose,
}: {
  report: ChatReportQueueItem | null;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useChatAdminReportTranscript(
    report?.id ?? "",
    undefined,
    // Nothing is fetched until an operator deliberately opens a report, so the
    // access trail only ever records a real read.
    {
      query: {
        enabled: report !== null,
        queryKey: getChatAdminReportTranscriptQueryKey(report?.id ?? ""),
        // Every fetch is written to the access trail, so only a deliberate
        // open may cause one. Refocusing the tab, reconnecting, remounting or
        // retrying a failure must not log a second read of the same messages.
        gcTime: 0,
        staleTime: Infinity,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchInterval: false,
      },
    },
  );

  // A window of forty messages is far taller than the dialog, and the reported
  // message sits in the middle of it. Put it in front of the operator instead
  // of making them hunt for it.
  const reportedMessageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    reportedMessageRef.current?.scrollIntoView({ block: "center" });
  }, [data]);

  return (
    <Dialog
      open={report !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Reported conversation</DialogTitle>
          <DialogDescription>
            {report?.room.name ?? "Direct conversation"} — read only. You are not
            joined to this conversation and nothing is marked as read. This view
            is recorded against your operator account.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <SectionLoader message="Loading conversation..." />
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-12 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Could not load this conversation.
          </div>
        ) : (
          <div
            data-testid="transcript-scroll"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
          >
            {data?.reportedMessageId && !data.reportedMessageFound && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                The reported message is no longer in the conversation. Showing
                the most recent messages instead.
              </p>
            )}
            {data?.hasMoreBefore && (
              <p className="text-center text-xs text-muted-foreground">
                Earlier messages are not shown.
              </p>
            )}
            {(data?.messages ?? []).length === 0 ? (
              <p className="py-12 text-center text-muted-foreground">
                This conversation has no messages.
              </p>
            ) : (
              (data?.messages ?? []).map((message) => (
                <div
                  key={message.id}
                  ref={message.isReportedMessage ? reportedMessageRef : undefined}
                  data-testid={
                    message.isReportedMessage
                      ? "transcript-message-reported"
                      : "transcript-message"
                  }
                  className={
                    message.isReportedMessage
                      ? "rounded-md border-2 border-red-300 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/20"
                      : "rounded-md border border-slate-200 p-3 dark:border-slate-800"
                  }
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {message.senderName}
                    </span>
                    {message.isFromReportedUser && (
                      <Badge
                        variant="outline"
                        className="border-red-200 text-red-600 dark:border-red-900/50 dark:text-red-300"
                      >
                        Reported user
                      </Badge>
                    )}
                    {message.isReportedMessage && (
                      <Badge variant="secondary">Reported message</Badge>
                    )}
                    <span>
                      {format(new Date(message.createdAt), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">
                    {message.body}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {message.hasAttachment && (
                      <span className="flex items-center gap-1">
                        <Paperclip className="h-3 w-3" />
                        {message.kind} attachment (not shown here)
                      </span>
                    )}
                    {message.deletedAt && (
                      <span>
                        Deleted by sender on{" "}
                        {format(new Date(message.deletedAt), "MMM d, yyyy HH:mm")}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
            {data?.hasMoreAfter && (
              <p className="text-center text-xs text-muted-foreground">
                Later messages are not shown.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
