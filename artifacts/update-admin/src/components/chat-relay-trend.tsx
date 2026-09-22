import { useMemo, useState } from "react";
import { format, startOfDay, subDays } from "date-fns";
import {
  type ChatRelayHeld,
  type ChatRelayRunRecord,
  useChatRelayHistoryGet,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format-bytes";
import { cn } from "@/lib/utils";
import { AlertTriangle, TrendingDown } from "lucide-react";

const RANGES = [7, 30, 90] as const;
type RangeDays = (typeof RANGES)[number];
const RECENT_RUNS_SHOWN = 10;

export type RelayDayBucket = {
  key: string;
  date: Date;
  bytes: number;
  runs: number;
  purged: number;
  expired: number;
  aborted: boolean;
};

export type RelayTrendSummary = {
  inRange: ChatRelayRunRecord[];
  /** One bucket per local calendar day, oldest first, covering the whole range. */
  days: RelayDayBucket[];
  totals: {
    runs: number;
    bytes: number;
    purged: number;
    expired: number;
    tombstonesPurged: number;
    alreadyGone: number;
    aborted: number;
    skipped: number;
  };
  /** Oldest run in the range that measured the relay afterwards, if any. */
  oldestSnapshot: ChatRelayRunRecord | null;
};

const dayKey = (date: Date) => format(date, "yyyy-MM-dd");

/**
 * Fold the server's newest-first run list into the selected range: per-day
 * buckets in the operator's local time (every day present, so quiet days show
 * as gaps) plus range totals. Pure so the browser check can reason about it.
 */
export function summariseRelayRuns(
  runs: ChatRelayRunRecord[],
  rangeDays: number,
  now: Date = new Date(),
): RelayTrendSummary {
  const today = startOfDay(now);
  const start = subDays(today, rangeDays - 1);
  const days: RelayDayBucket[] = [];
  const byKey = new Map<string, RelayDayBucket>();
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = subDays(today, offset);
    const bucket: RelayDayBucket = {
      key: dayKey(date),
      date,
      bytes: 0,
      runs: 0,
      purged: 0,
      expired: 0,
      aborted: false,
    };
    days.push(bucket);
    byKey.set(bucket.key, bucket);
  }
  const totals: RelayTrendSummary["totals"] = {
    runs: 0,
    bytes: 0,
    purged: 0,
    expired: 0,
    tombstonesPurged: 0,
    alreadyGone: 0,
    aborted: 0,
    skipped: 0,
  };
  const inRange: ChatRelayRunRecord[] = [];
  for (const run of runs) {
    const ranAt = new Date(run.ranAt);
    if (ranAt < start || ranAt > now) continue;
    inRange.push(run);
    totals.runs += 1;
    totals.bytes += run.bytesReclaimed;
    totals.purged += run.purged;
    totals.expired += run.expired;
    totals.tombstonesPurged += run.tombstonesPurged;
    totals.alreadyGone += run.alreadyGone;
    if (run.abortedError) totals.aborted += 1;
    if (run.skipped) totals.skipped += 1;
    const bucket = byKey.get(dayKey(ranAt));
    if (bucket) {
      bucket.bytes += run.bytesReclaimed;
      bucket.runs += 1;
      bucket.purged += run.purged;
      bucket.expired += run.expired;
      if (run.abortedError) bucket.aborted = true;
    }
  }
  const oldestSnapshot =
    [...inRange].reverse().find((run) => run.heldBytes !== null && run.heldObjects !== null) ?? null;
  return { inRange, days, totals, oldestSnapshot };
}

function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}

function runOutcome(run: ChatRelayRunRecord): { label: string; tone: "ok" | "warn" | "muted" } {
  if (run.skipped === "disabled") return { label: "Switched off", tone: "muted" };
  if (run.skipped === "min_build_not_met") return { label: "Blocked by app build", tone: "muted" };
  if (run.abortedError) return { label: "Stopped early", tone: "warn" };
  if (run.failed > 0) return { label: `${plural(run.failed, "failure")}`, tone: "warn" };
  return { label: "Completed", tone: "ok" };
}

function HeldDelta({ held, since }: { held: ChatRelayHeld; since: ChatRelayRunRecord | null }) {
  if (!since || since.heldBytes === null || since.heldObjects === null) {
    return (
      <p className="text-xs text-muted-foreground">
        No earlier measurement in this range to compare with yet.
      </p>
    );
  }
  const bytesDelta = held.bytes - since.heldBytes;
  const objectsDelta = held.objects - since.heldObjects;
  const sinceLabel = format(new Date(since.ranAt), "d MMM");
  if (bytesDelta === 0 && objectsDelta === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="text-relay-trend-held-delta">
        Unchanged since the run on {sinceLabel}.
      </p>
    );
  }
  const shrinking = bytesDelta < 0 || (bytesDelta === 0 && objectsDelta < 0);
  return (
    <p
      className={cn("text-xs", shrinking ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")}
      data-testid="text-relay-trend-held-delta"
    >
      {shrinking ? "▼" : "▲"} {formatBytes(Math.abs(bytesDelta))} {shrinking ? "smaller" : "larger"} than after
      the run on {sinceLabel} ({objectsDelta >= 0 ? "+" : "−"}
      {plural(Math.abs(objectsDelta), "file")}).
    </p>
  );
}

/**
 * Trend view of the relay purge: what it reclaimed per day, whether removed
 * media had been collected by every recipient or simply expired, and how much
 * the relay still holds. Derived from the bounded run history the purge
 * records for whole-relay runs; room-scoped runs are not part of it.
 */
export function ChatRelayTrend() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const { data, isLoading, isError } = useChatRelayHistoryGet();
  const summary = useMemo(
    () => (data ? summariseRelayRuns(data.runs, rangeDays) : null),
    [data, rangeDays],
  );

  const maxDayBytes = summary ? Math.max(0, ...summary.days.map((day) => day.bytes)) : 0;
  const removed = summary ? summary.totals.purged + summary.totals.expired : 0;
  const purgedShare = removed > 0 && summary ? summary.totals.purged / removed : null;
  const uncollectedDominates = removed > 0 && summary !== null && summary.totals.expired > summary.totals.purged;
  const recentRuns = summary ? summary.inRange.slice(0, RECENT_RUNS_SHOWN) : [];
  const firstDay = summary?.days[0];
  const lastDay = summary?.days[summary.days.length - 1];
  const middleDay = summary ? summary.days[Math.floor(summary.days.length / 2)] : undefined;

  return (
    <Card data-testid="card-chat-relay-trend">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              Relay storage over time
            </CardTitle>
            <CardDescription>
              Every whole-relay purge run (the daily timer and Run now) is kept
              for {data?.windowDays ?? 90} days so you can see whether the relay
              is shrinking or media keeps piling up because phones never store
              it. Days are shown in your local time.
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(rangeDays)}
            onValueChange={(value) => {
              const next = Number(value);
              if (RANGES.includes(next as RangeDays)) setRangeDays(next as RangeDays);
            }}
            aria-label="Trend range"
          >
            {RANGES.map((days) => (
              <ToggleGroupItem
                key={days}
                value={String(days)}
                aria-label={`Last ${days} days`}
                data-testid={`toggle-relay-trend-range-${days}`}
              >
                {days}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner size={16} label={null} />
            Loading run history...
          </div>
        ) : isError || !data || !summary ? (
          <div
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            data-testid="text-relay-trend-error"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            Could not load the run history. Reload the page to try again.
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3 space-y-1" data-testid="text-relay-trend-reclaimed">
                <p className="text-xs text-muted-foreground">Reclaimed in the last {rangeDays} days</p>
                <p className="text-2xl font-semibold tabular-nums">{formatBytes(summary.totals.bytes)}</p>
                <p className="text-xs text-muted-foreground">
                  {plural(removed + summary.totals.tombstonesPurged, "file")} removed across{" "}
                  {plural(summary.totals.runs, "run")}
                  {summary.totals.alreadyGone > 0
                    ? ` · ${summary.totals.alreadyGone} already gone`
                    : ""}
                  {summary.totals.aborted > 0
                    ? ` · ${plural(summary.totals.aborted, "run")} stopped early`
                    : ""}
                </p>
              </div>

              <div className="rounded-md border p-3 space-y-2" data-testid="text-relay-trend-ratio">
                <p className="text-xs text-muted-foreground">Collected vs uncollected</p>
                {purgedShare === null ? (
                  <p className="text-sm text-muted-foreground">No media removed in this range.</p>
                ) : (
                  <>
                    <div
                      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${Math.round(purgedShare * 100)}% collected by every recipient, ${Math.round((1 - purgedShare) * 100)}% expired uncollected`}
                    >
                      <div className="bg-emerald-500" style={{ width: `${purgedShare * 100}%` }} />
                      <div className="bg-amber-500" style={{ width: `${(1 - purgedShare) * 100}%` }} />
                    </div>
                    <p className="text-sm tabular-nums">
                      <span className="font-medium">{Math.round(purgedShare * 100)}%</span> collected ·{" "}
                      <span className="font-medium">{Math.round((1 - purgedShare) * 100)}%</span> expired
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {summary.totals.purged} removed after every recipient stored it ·{" "}
                      {summary.totals.expired} expired before everyone collected it
                    </p>
                  </>
                )}
              </div>

              <div className="rounded-md border p-3 space-y-1" data-testid="text-relay-trend-held">
                <p className="text-xs text-muted-foreground">Still on the relay now</p>
                <p className="text-2xl font-semibold tabular-nums">{formatBytes(data.held.bytes)}</p>
                <p className="text-xs text-muted-foreground">
                  {plural(data.held.objects, "file")}
                  {data.held.pinnedObjects > 0
                    ? ` · ${plural(data.held.pinnedObjects, "file")} (${formatBytes(data.held.pinnedBytes)}) kept as report evidence`
                    : ""}
                  {data.held.unknownSizeObjects > 0
                    ? ` · ${plural(data.held.unknownSizeObjects, "older file")} without a recorded size`
                    : ""}
                </p>
                <HeldDelta held={data.held} since={summary.oldestSnapshot} />
              </div>
            </div>

            {uncollectedDominates && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                data-testid="text-relay-trend-uncollected-warning"
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Most media removed in this range had not been collected by every
                  recipient when it expired. The relay is only shrinking because of the
                  hard expiry, not because phones are storing their copies — check that
                  recipients are on a current app build before relying on the purge.
                </span>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Reclaimed per day</span>
                <span className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-primary" /> reclaimed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-sm bg-destructive" /> a run stopped early
                  </span>
                </span>
              </div>
              {summary.totals.runs === 0 ? (
                <p
                  className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground"
                  data-testid="text-relay-trend-empty"
                >
                  {data.runs.length === 0
                    ? "No whole-relay runs recorded yet. The trend fills in after the first daily run or Run now."
                    : `No whole-relay runs in the last ${rangeDays} days.`}
                </p>
              ) : (
                <div
                  className="flex h-28 items-end gap-px rounded-md border bg-muted/30 p-2"
                  role="img"
                  aria-label={`Bytes reclaimed per day over the last ${rangeDays} days`}
                  data-testid="chart-relay-trend"
                >
                  {summary.days.map((day) => {
                    const share = maxDayBytes > 0 ? day.bytes / maxDayBytes : 0;
                    const height = day.bytes > 0 ? Math.max(4, Math.round(share * 100)) : 0;
                    return (
                      <div
                        key={day.key}
                        className="flex h-full flex-1 flex-col justify-end"
                        title={`${format(day.date, "d MMM")}: ${formatBytes(day.bytes)} reclaimed, ${plural(day.runs, "run")}${
                          day.runs > 0 ? `, ${day.purged} collected, ${day.expired} expired` : ""
                        }`}
                        data-testid={`bar-relay-trend-${day.key}`}
                        data-bytes={day.bytes}
                        data-runs={day.runs}
                      >
                        {day.bytes > 0 ? (
                          <div
                            className={cn("w-full rounded-t-sm", day.aborted ? "bg-destructive" : "bg-primary")}
                            style={{ height: `${height}%` }}
                          />
                        ) : day.runs > 0 ? (
                          <div
                            className={cn("h-0.5 w-full rounded-sm", day.aborted ? "bg-destructive" : "bg-muted-foreground/50")}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {firstDay && lastDay && summary.totals.runs > 0 && (
                <div className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
                  <span>{format(firstDay.date, "d MMM")}</span>
                  {middleDay && middleDay !== firstDay && middleDay !== lastDay && (
                    <span>{format(middleDay.date, "d MMM")}</span>
                  )}
                  <span>{format(lastDay.date, "d MMM")}</span>
                </div>
              )}
            </div>

            {recentRuns.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Recent runs{summary.inRange.length > RECENT_RUNS_SHOWN ? ` (newest ${RECENT_RUNS_SHOWN} of ${summary.inRange.length})` : ""}
                </p>
                <div className="overflow-x-auto rounded-md border">
                  <Table data-testid="table-relay-trend-runs">
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead className="text-right">Collected</TableHead>
                        <TableHead className="text-right">Expired</TableHead>
                        <TableHead className="text-right" title="Files of messages deleted for everyone">
                          Deleted
                        </TableHead>
                        <TableHead className="text-right">Reclaimed</TableHead>
                        <TableHead className="text-right">Relay after</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentRuns.map((run) => {
                        const outcome = runOutcome(run);
                        return (
                          <TableRow key={run.id} data-testid={`row-relay-trend-run-${run.id}`}>
                            <TableCell className="whitespace-nowrap tabular-nums">
                              <div>{format(new Date(run.ranAt), "d MMM, h:mm a")}</div>
                              <div className="text-xs text-muted-foreground">
                                {run.trigger === "manual" ? "Run now" : "Daily timer"}
                              </div>
                            </TableCell>
                            <TableCell
                              className={cn(
                                "whitespace-nowrap",
                                outcome.tone === "warn" && "text-destructive",
                                outcome.tone === "muted" && "text-muted-foreground",
                              )}
                              title={run.abortedError ?? undefined}
                            >
                              {outcome.label}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{run.purged}</TableCell>
                            <TableCell className="text-right tabular-nums">{run.expired}</TableCell>
                            <TableCell className="text-right tabular-nums">{run.tombstonesPurged}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBytes(run.bytesReclaimed)}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">
                              {run.heldBytes === null || run.heldObjects === null
                                ? "—"
                                : `${formatBytes(run.heldBytes)} · ${plural(run.heldObjects, "file")}`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
