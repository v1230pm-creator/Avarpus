import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ChatReportQueueItem,
  type ChatReportReviewInputStatus,
  useChatAdminReportBatchWithdraw,
  useChatAdminReportList,
  useChatAdminReportStatusBatch,
  useChatAdminReportStatusUpdate,
  getChatAdminReportListQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { SectionLoader, Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { TranscriptDialog } from "./transcript-dialog";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Eye,
  Flag,
  Gavel,
  MessageSquareWarning,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Undo2,
  User,
  X,
} from "lucide-react";

// Typing in the search box must not fire a queue query per keystroke: the list
// joins both parties of every report, and an operator types a whole mobile
// number in one go.
const SEARCH_DEBOUNCE_MS = 300;

const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  scam: "Scam",
  inappropriate: "Inappropriate",
  other: "Other",
};

const DECISIONS: Array<{
  status: ChatReportReviewInputStatus;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
}> = [
  {
    status: "reviewed",
    label: "Mark reviewed",
    description: "You have read this report and are still deciding what to do.",
    icon: ShieldCheck,
  },
  {
    status: "actioned",
    label: "Action taken",
    description:
      "You acted on the reported account or conversation. This closes the report.",
    icon: Gavel,
  },
  {
    status: "dismissed",
    label: "Dismiss",
    description:
      "The report needs no action. This closes the report.",
    icon: ShieldX,
  },
];

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// How many of the reports a batch is about to move are named in the
// confirmation. Enough to cover any realistic pile-on; if an account has drawn
// more than this, the step says so rather than implying the list is complete.
const BATCH_PREVIEW_LIMIT = 25;

// The offer to take a bulk decision back. It belongs to one operator in one
// tab for a few minutes, and a misclick is often followed by a reload, so it
// outlives a page load without becoming shared state.
type UndoOffer = {
  batchId: string;
  decisionLabel: string;
  accountLabel: string;
  appliedCount: number;
  // Epoch milliseconds. The server decides when the window closes; this is
  // only what the page shows and when it stops offering the button.
  expiresAt: number;
};

const UNDO_STORAGE_KEY = "chat-report-undo-offer";

function readStoredUndoOffer(): UndoOffer | null {
  try {
    const raw = sessionStorage.getItem(UNDO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UndoOffer>;
    if (typeof parsed.batchId !== "string" || typeof parsed.expiresAt !== "number") {
      return null;
    }
    // An offer whose window has already closed would be a button the server
    // refuses.
    return parsed.expiresAt > Date.now() ? (parsed as UndoOffer) : null;
  } catch {
    return null;
  }
}

function storeUndoOffer(offer: UndoOffer | null): void {
  try {
    if (offer) sessionStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(offer));
    else sessionStorage.removeItem(UNDO_STORAGE_KEY);
  } catch {
    // A browser with storage locked down still gets the in-page offer.
  }
}

function accountLabelOf(report: ChatReportQueueItem): string {
  return report.reportedUser.name ?? report.reportedUser.mobile ?? "this account";
}

function withdrawalFailureMessage(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  return typeof data?.message === "string"
    ? data.message
    : "Could not withdraw this batch. Reload the queue and check the reports.";
}

function statusBadge(status: string) {
  switch (status) {
    case "open":
      return (
        <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" variant="secondary">
          Open
        </Badge>
      );
    case "reviewed":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" variant="secondary">
          Reviewed
        </Badge>
      );
    case "actioned":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" variant="secondary">
          Action taken
        </Badge>
      );
    case "dismissed":
      return (
        <Badge variant="outline" className="text-slate-600 dark:text-slate-300">
          Dismissed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function Party({
  label,
  name,
  mobile,
  tone,
}: {
  label: string;
  name: string | null;
  mobile: string | null;
  tone: "reporter" | "reported";
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className={
            tone === "reported"
              ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
              : "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300"
          }
        >
          {tone === "reported" ? <Flag className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900 dark:text-slate-100">
            {name ?? "Unknown user"}
          </div>
          <div className="truncate text-sm text-slate-500">{mobile ?? "No mobile on file"}</div>
        </div>
      </div>
    </div>
  );
}

export default function ChatReports() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Drilling into one account is a filter on that exact account, not a search
  // for its name: a search would also turn up reports that account has filed.
  const [focusedAccount, setFocusedAccount] = useState<
    { id: string; label: string } | null
  >(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [pending, setPending] = useState<
    { report: ChatReportQueueItem; status: ChatReportReviewInputStatus } | null
  >(null);
  const [note, setNote] = useState("");
  // Whether this decision should also settle the other reports still open
  // against the same account.
  const [applyToAll, setApplyToAll] = useState(false);
  // A batch moves other people's complaints, so it is named and confirmed
  // before it runs rather than recorded from the queue card in one click.
  const [confirmingBatch, setConfirmingBatch] = useState(false);
  const [undoOffer, setUndoOffer] = useState<UndoOffer | null>(readStoredUndoOffer);
  const [transcriptFor, setTranscriptFor] = useState<ChatReportQueueItem | null>(
    null,
  );

  const { data, isLoading, isFetching, error } = useChatAdminReportList({
    status: statusFilter !== "all" ? (statusFilter as ChatReportQueueItem["status"]) : undefined,
    search: search || undefined,
    reportedUserId: focusedAccount?.id,
    cursor,
  });
  const searchBusy = isFetching && search.trim().length > 0;
  const statusUpdate = useChatAdminReportStatusUpdate();
  const statusBatch = useChatAdminReportStatusBatch();
  const withdrawBatch = useChatAdminReportBatchWithdraw();
  const saving = statusUpdate.isPending || statusBatch.isPending;

  const resetPagination = () => {
    setCursor(undefined);
    setPreviousCursors([]);
  };

  // A new search is a different result set, so the cursor from the old one
  // would page into rows that no longer belong to it.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const timer = setTimeout(() => {
      setSearch(trimmed);
      setCursor(undefined);
      setPreviousCursors([]);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  const closeDialog = () => {
    setPending(null);
    setNote("");
    setApplyToAll(false);
    setConfirmingBatch(false);
  };

  // Only meaningful while the report the operator is acting from still has
  // other open complaints against the same account.
  const otherOpen = pending?.report.otherOpenReports ?? 0;
  const batchable = applyToAll && otherOpen > 0;

  // What the batch is about to move, named before it runs. It is the same
  // filter the "other open reports" count is built from — reports open against
  // this exact account — plus the report the operator is acting from, which
  // may itself already be reviewed rather than open.
  const batchPreviewParams = {
    status: "open" as const,
    reportedUserId: pending?.report.reportedUser.id,
    limit: BATCH_PREVIEW_LIMIT,
  };
  const batchPreview = useChatAdminReportList(batchPreviewParams, {
    query: {
      enabled: confirmingBatch && batchable,
      queryKey: getChatAdminReportListQueryKey(batchPreviewParams),
    },
  });
  const previewReports = pending
    ? [
      pending.report,
      ...(batchPreview.data?.reports ?? []).filter(
        (entry) => entry.id !== pending.report.id,
      ),
    ]
    : [];

  const setUndo = (offer: UndoOffer | null) => {
    setUndoOffer(offer);
    storeUndoOffer(offer);
  };

  // The offer stops being made the moment the server would refuse it.
  useEffect(() => {
    if (!undoOffer) return;
    const remaining = undoOffer.expiresAt - Date.now();
    if (remaining <= 0) {
      setUndo(null);
      return;
    }
    const timer = setTimeout(() => setUndo(null), remaining);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoOffer]);

  const withdrawPendingBatch = () => {
    if (!undoOffer) return;
    withdrawBatch.mutate(
      { batchId: undoOffer.batchId },
      {
        onSuccess: (result) => {
          setUndo(null);
          queryClient.invalidateQueries({ queryKey: getChatAdminReportListQueryKey() });
          toast({
            title: "Bulk decision withdrawn",
            description:
              `${countLabel(result.restoredCount, "report")} `
              + `${result.restoredCount === 1 ? "is" : "are"} back where `
              + `${result.restoredCount === 1 ? "it was" : "they were"}.`
              + (result.skippedCount > 0
                // Another operator has judged those since. Their decision is
                // not this operator's to take back.
                ? ` ${countLabel(result.skippedCount, "report")} another operator has `
                  + `decided since ${result.skippedCount === 1 ? "was" : "were"} left alone.`
                : "")
              + " Reporters keep the alert they were already sent.",
          });
        },
        onError: (withdrawError) => {
          // The window closed, somebody else's decision is now on the rows, or
          // the batch was already taken back. Either way the offer is spent.
          setUndo(null);
          queryClient.invalidateQueries({ queryKey: getChatAdminReportListQueryKey() });
          toast({
            title: "Could not withdraw",
            description: withdrawalFailureMessage(withdrawError),
            variant: "destructive",
          });
        },
      },
    );
  };

  const submitDecision = () => {
    if (!pending) return;
    const decision = DECISIONS.find((entry) => entry.status === pending.status);
    const label = decision?.label ?? "Decision";
    const variables = {
      id: pending.report.id,
      data: { status: pending.status, note: note.trim() || undefined },
    };
    const onError = () => {
      toast({
        title: "Update failed",
        description: "Could not record the decision. Reload and try again.",
        variant: "destructive",
      });
    };
    const settled = () => {
      closeDialog();
      queryClient.invalidateQueries({ queryKey: getChatAdminReportListQueryKey() });
    };

    if (batchable) {
      const accountLabel = accountLabelOf(pending.report);
      statusBatch.mutate(variables, {
        onSuccess: (result) => {
          toast({
            title: "Reports updated",
            description:
              `${label} recorded on ${countLabel(result.appliedCount, "report")}.`
              + (result.skippedCount > 0
                // Somebody else got there first on those, and their decision
                // stands — the operator should not think this batch moved them.
                ? ` ${countLabel(result.skippedCount, "other report")} about this account `
                  + `${result.skippedCount === 1 ? "was" : "were"} already decided and left alone.`
                : ""),
          });
          // Moderation state is one-way, so the way back from a misclick is
          // this batch and this operator only, for as long as the server says.
          setUndo({
            batchId: result.batchId,
            decisionLabel: label,
            accountLabel,
            appliedCount: result.appliedCount,
            expiresAt: new Date(result.withdrawableUntil).getTime(),
          });
          settled();
        },
        onError,
      });
      return;
    }

    statusUpdate.mutate(variables, {
      onSuccess: () => {
        toast({ title: "Report updated", description: `${label} recorded.` });
        settled();
      },
      onError,
    });
  };

  const reports = data?.reports ?? [];

  return (
    <div className="min-h-screen flex-1 overflow-auto bg-slate-50/50 p-6 dark:bg-slate-950/50 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Chat Reports</h1>
            <p className="mt-1 text-muted-foreground">
              Abuse reports users filed against a direct conversation, newest first.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {typeof data?.openCount === "number" && (
              <span className="whitespace-nowrap text-sm text-muted-foreground">
                {data.openCount} open in total
              </span>
            )}
            <div className="relative w-full sm:w-[260px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <span className="pointer-events-none absolute left-8 top-2.5 flex size-4 items-center justify-center">
                {searchBusy ? <Spinner size={14} label={null} /> : null}
              </span>
              <Input
                aria-label="Search reports"
                placeholder="Search reporter or reported user..."
                value={searchInput}
                maxLength={64}
                onChange={(event) => setSearchInput(event.target.value)}
                className="bg-card pl-14"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                resetPagination();
              }}
            >
              <SelectTrigger className="w-[180px] bg-card">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="reviewed">Reviewed</SelectItem>
                <SelectItem value="actioned">Action taken</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {undoOffer && (
          // A misclick on a bulk decision settles several people's complaints
          // at once, and the queue offers no reopen. This is the way back, for
          // the operator who recorded it, for as long as the server allows.
          <div
            data-testid="undo-batch-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {undoOffer.decisionLabel} recorded on{" "}
                {countLabel(undoOffer.appliedCount, "report")} about {undoOffer.accountLabel}.
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80">
                Wrong account? You can put those reports back until{" "}
                {format(new Date(undoOffer.expiresAt), "HH:mm")}. Reporters keep
                the alert they were already sent.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="undo-batch"
                onClick={withdrawPendingBatch}
                disabled={withdrawBatch.isPending}
              >
                {withdrawBatch.isPending
                  ? <Spinner className="mr-2" size={14} label={null} />
                  : <Undo2 className="mr-2 h-3.5 w-3.5" />}
                Undo this batch
              </Button>
              <Button
                variant="ghost"
                size="sm"
                data-testid="dismiss-undo-batch"
                onClick={() => setUndo(null)}
                disabled={withdrawBatch.isPending}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}

        {focusedAccount && (
          // Without this the queue would silently be showing one account's
          // reports with no way back to the whole list.
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Showing reports about</span>
            <button
              type="button"
              data-testid="focused-account"
              onClick={() => {
                setFocusedAccount(null);
                resetPagination();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/60"
            >
              {focusedAccount.label}
              <X className="h-3.5 w-3.5" />
              <span className="sr-only">Show the whole queue again</span>
            </button>
          </div>
        )}

        {isLoading ? (
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent>
              <SectionLoader message="Loading reports..." />
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent className="flex flex-col items-center justify-center p-12 text-destructive">
              <AlertCircle className="mb-4 h-10 w-10 opacity-50" />
              <p>Failed to load reports. Please try again.</p>
            </CardContent>
          </Card>
        ) : reports.length === 0 ? (
          <Card className="border-slate-200 shadow-sm dark:border-slate-800">
            <CardContent className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-900">
                <MessageSquareWarning className="h-8 w-8 text-slate-400" />
              </div>
              <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                Nothing to review
              </h3>
              <p className="mt-1">
                {focusedAccount
                  ? `No reports about ${focusedAccount.label} match this filter.`
                  : search
                  ? `No reports match "${search}" with this filter.`
                  : "No reports match this filter."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => {
              const allowed = DECISIONS.filter((decision) => {
                if (report.status === "open") return true;
                if (report.status === "reviewed") return decision.status !== "reviewed";
                return false;
              });
              return (
                <Card
                  key={report.id}
                  className="border-slate-200 shadow-sm dark:border-slate-800"
                >
                  <CardHeader className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-600 dark:border-red-900/50 dark:bg-red-950/20">
                        {REASON_LABELS[report.reason] ?? report.reason}
                      </Badge>
                      {statusBadge(report.status)}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(report.createdAt), "MMM d, yyyy HH:mm")}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Party
                        label="Reported by"
                        name={report.reporter.name}
                        mobile={report.reporter.mobile}
                        tone="reporter"
                      />
                      <div className="min-w-0 space-y-2">
                        <Party
                          label="Reported user"
                          name={report.reportedUser.name}
                          mobile={report.reportedUser.mobile}
                          tone="reported"
                        />
                        {report.otherOpenReports > 0 && (
                          <button
                            type="button"
                            data-testid="other-open-reports"
                            onClick={() => {
                              // Jump straight to everything still open about
                              // this account: one complaint reads differently
                              // once several people have filed one.
                              setFocusedAccount({
                                id: report.reportedUser.id,
                                label: report.reportedUser.name
                                  ?? report.reportedUser.mobile
                                  ?? "this account",
                              });
                              setSearchInput("");
                              setSearch("");
                              setStatusFilter("open");
                              resetPagination();
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/60"
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {report.otherOpenReports === 1
                              ? "1 other open report about this user"
                              : `${report.otherOpenReports} other open reports about this user`}
                          </button>
                        )}
                      </div>
                    </div>

                    {report.details && (
                      <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                        {report.details}
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      Conversation: {report.room.name ?? "Untitled room"} · {report.room.id}
                      {report.messageId ? ` · message ${report.messageId}` : ""}
                    </div>

                    {report.status !== "open" && (
                      <div className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-800">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {report.reviewerName ?? "An operator"} recorded this decision
                            {report.reviewedAt
                              ? ` on ${format(new Date(report.reviewedAt), "MMM d, yyyy HH:mm")}`
                              : ""}
                          </div>
                          {report.reviewNote && (
                            <p className="mt-1 text-slate-600 dark:text-slate-300">
                              {report.reviewNote}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTranscriptFor(report)}
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View conversation
                      </Button>
                    </div>

                    {allowed.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {allowed.map((decision) => {
                          const Icon = decision.icon;
                          return (
                            <Button
                              key={decision.status}
                              variant={decision.status === "actioned" ? "default" : "outline"}
                              size="sm"
                              onClick={() => {
                                setPending({ report, status: decision.status });
                                setNote("");
                                setApplyToAll(false);
                              }}
                            >
                              <Icon className="mr-2 h-4 w-4" />
                              {decision.label}
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        This report is closed. Its decision cannot be changed.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}

            {(previousCursors.length > 0 || data?.nextCursor) && (
              <div className="flex items-center justify-between gap-3 px-1 py-2">
                <Button
                  variant="outline"
                  disabled={isLoading || previousCursors.length === 0}
                  onClick={() => {
                    const nextHistory = previousCursors.slice(0, -1);
                    setCursor(previousCursors[previousCursors.length - 1]);
                    setPreviousCursors(nextHistory);
                  }}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {previousCursors.length + 1}
                </span>
                <Button
                  variant="outline"
                  disabled={isLoading || !data?.nextCursor}
                  onClick={() => {
                    if (!data?.nextCursor) return;
                    setPreviousCursors((history) => [...history, cursor]);
                    setCursor(data.nextCursor ?? undefined);
                  }}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <TranscriptDialog
        report={transcriptFor}
        onClose={() => setTranscriptFor(null)}
      />

      <Dialog open={pending !== null} onOpenChange={(open) => (open ? undefined : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmingBatch
                ? "Confirm this bulk decision"
                : DECISIONS.find((entry) => entry.status === pending?.status)?.label ?? "Record decision"}
            </DialogTitle>
            <DialogDescription>
              {confirmingBatch
                ? `These reports move to "${
                  DECISIONS.find((entry) => entry.status === pending?.status)?.label ?? "this decision"
                }" together. Moderation decisions are one-way.`
                : DECISIONS.find((entry) => entry.status === pending?.status)?.description}
            </DialogDescription>
          </DialogHeader>
          {confirmingBatch ? (
            // Named before it runs: the operator clicked from one card, and a
            // batch settles complaints several other people are waiting on.
            <div className="space-y-3" data-testid="batch-confirmation">
              {batchPreview.isLoading ? (
                <SectionLoader message="Checking what this will move..." />
              ) : batchPreview.error ? (
                <p className="text-sm text-destructive">
                  Could not list the reports this would move. Go back and decide
                  this report on its own, or reload the queue.
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium" data-testid="batch-confirm-count">
                    {countLabel(previewReports.length, "report")} about{" "}
                    {pending ? accountLabelOf(pending.report) : "this account"} will move.
                  </p>
                  <ul
                    className="max-h-56 space-y-2 overflow-auto rounded-md border border-slate-200 p-2 dark:border-slate-800"
                    data-testid="batch-confirm-list"
                  >
                    {previewReports.map((entry) => (
                      <li key={entry.id} className="rounded-sm bg-slate-50 p-2 text-xs dark:bg-slate-900/50">
                        <div className="font-medium">
                          {entry.reporter.name ?? entry.reporter.mobile ?? "Unknown reporter"}
                          {entry.id === pending?.report.id && (
                            <span className="ml-2 font-normal text-muted-foreground">
                              (the report you opened)
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground">
                          {REASON_LABELS[entry.reason] ?? entry.reason} ·{" "}
                          {format(new Date(entry.createdAt), "d MMM yyyy, HH:mm")}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {batchPreview.data?.nextCursor && (
                    <p className="text-xs text-muted-foreground">
                      This account has more open reports than are listed here. All
                      of them will move.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Every reporter is told once. Reports another operator has
                    already decided are left alone. You can undo this batch for a
                    short while afterwards.
                  </p>
                </>
              )}
            </div>
          ) : (
          <>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="chat-report-note">
              Note (optional)
            </label>
            <Textarea
              id="chat-report-note"
              value={note}
              maxLength={2000}
              placeholder="What did you find, and what did you do about it?"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {otherOpen > 0 && (
            // Several people complaining about one account is one judgement,
            // not five. Each report still keeps its own row, note and author.
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
              <Checkbox
                id="chat-report-apply-all"
                data-testid="apply-to-all-open"
                className="mt-0.5"
                checked={applyToAll}
                onCheckedChange={(checked) => setApplyToAll(checked === true)}
              />
              <div className="space-y-1">
                <label
                  className="text-sm font-medium leading-none"
                  htmlFor="chat-report-apply-all"
                >
                  Also apply to {countLabel(otherOpen, "other open report")} about{" "}
                  {pending?.report.reportedUser.name
                    ?? pending?.report.reportedUser.mobile
                    ?? "this account"}
                </label>
                <p className="text-xs text-muted-foreground">
                  Each report keeps its own record of this decision and your note.
                  Every reporter is told once, and reports another operator has
                  already decided are left alone.
                </p>
              </div>
            </div>
          )}
          </>
          )}
          <DialogFooter>
            {confirmingBatch ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingBatch(false)}
                  disabled={saving}
                >
                  Back
                </Button>
                <Button
                  onClick={submitDecision}
                  data-testid="confirm-batch"
                  disabled={saving || batchPreview.isLoading || Boolean(batchPreview.error)}
                >
                  {saving && <Spinner className="mr-2" size={16} label={null} />}
                  Record on {countLabel(previewReports.length, "report")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={closeDialog} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  onClick={() => (batchable ? setConfirmingBatch(true) : submitDecision())}
                  disabled={saving}
                >
                  {saving && <Spinner className="mr-2" size={16} label={null} />}
                  {batchable ? "Review what this moves" : "Save decision"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
