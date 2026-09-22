import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  type ChatRelaySettings as ChatRelaySettingsData,
  getChatRelayHistoryGetQueryKey,
  getChatRelaySettingsGetQueryKey,
  useChatRelayPurgeRun,
  useChatRelaySettingsGet,
  useChatRelaySettingsUpdate,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/format-bytes";
import { AlertTriangle, HardDriveDownload, ShieldAlert } from "lucide-react";

function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } } | undefined)?.data;
  return data?.message ?? fallback;
}

/**
 * Operator controls for the chat media relay purge. The switch ships off and
 * the server refuses to turn it on until the published minimum app build keeps
 * chat media on the device — older apps would otherwise lose photos and files
 * the moment the relay copy is deleted.
 */
export function ChatRelaySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useChatRelaySettingsGet();
  const [enabled, setEnabled] = useState(false);
  const [graceDays, setGraceDays] = useState("7");
  const [expiryDays, setExpiryDays] = useState("30");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data) {
      setEnabled(data.enabled);
      setGraceDays(String(data.graceDays));
      setExpiryDays(String(data.expiryDays));
    }
  }, [data, touched]);

  const applySettings = (settings: ChatRelaySettingsData) => {
    queryClient.setQueryData(getChatRelaySettingsGetQueryKey(), settings);
    setTouched(false);
  };

  const update = useChatRelaySettingsUpdate({
    mutation: {
      onSuccess: (result) => {
        applySettings(result);
        toast({
          title: result.enabled ? "Relay purge switched on" : "Relay purge settings saved",
          description: result.enabled
            ? `Delivered media is removed ${result.graceDays} days after send; undelivered media expires after ${result.expiryDays} days.`
            : "The daily purge stays off; chat media remains on the relay.",
        });
      },
      onError: (err) => {
        toast({
          title: "Could not save",
          description: errorMessage(
            err,
            "Check the values and try again.",
          ),
          variant: "destructive",
        });
      },
    },
  });

  const run = useChatRelayPurgeRun({
    mutation: {
      onSuccess: ({ result, settings }) => {
        applySettings(settings);
        // A whole-relay run just added a row to the history; refresh the trend.
        void queryClient.invalidateQueries({ queryKey: getChatRelayHistoryGetQueryKey() });
        toast({
          title: result.skipped
            ? "Purge did not run"
            : result.abortedError
              ? "Purge stopped early"
              : "Purge completed",
          description: result.skipped
            ? result.skippedReason ?? "The purge is not allowed to run right now."
            : `${result.purged} purged, ${result.expired} expired, ${formatBytes(result.bytesReclaimed)} reclaimed${
                result.abortedError ? ` — stopped on a storage error (${result.abortedError})` : ""
              }.`,
          variant: result.abortedError ? "destructive" : undefined,
        });
      },
      onError: (err) => {
        toast({
          title: "Could not run the purge",
          description: errorMessage(err, "Try again in a moment."),
          variant: "destructive",
        });
      },
    },
  });

  const grace = Number(graceDays);
  const expiry = Number(expiryDays);
  const graceInvalid = !Number.isInteger(grace) || grace < 1 || grace > 365;
  const expiryInvalid = !Number.isInteger(expiry) || expiry < 1 || expiry > 3650 || (!graceInvalid && expiry < grace);
  const enableBlocked = enabled && !data?.enabled && data?.canEnable === false;
  const dirty =
    !!data &&
    (enabled !== data.enabled || grace !== data.graceDays || expiry !== data.expiryDays);

  const handleSave = () => {
    if (graceInvalid || expiryInvalid || enableBlocked) return;
    update.mutate({ data: { enabled, graceDays: grace, expiryDays: expiry } });
  };

  const lastRun = data?.lastRun ?? null;

  return (
    <Card data-testid="card-chat-relay">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveDownload className="h-5 w-5 text-primary" />
          Chat media relay purge
        </CardTitle>
        <CardDescription>
          Phones keep their own copy of chat photos, videos and files. When this
          is on, the server deletes its relay copy once every recipient has
          stored theirs (after a grace period) and expires media nobody
          collected. Message text and details are never removed. Media under an
          open abuse report is kept until the report is closed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner size={16} label={null} />
            Loading current setting...
          </div>
        ) : isError || !data ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            Could not load the current setting. Reload the page to try again.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="chat-relay-enabled" className="text-sm font-medium">
                  Daily relay purge
                </Label>
                <p className="text-xs text-muted-foreground">
                  Requires every installed app to be build {data.requiredAppBuild} or
                  newer. Current published minimum:{" "}
                  {data.minimumSupportedBuild === null
                    ? "no critical release published"
                    : `build ${data.minimumSupportedBuild}`}
                  .
                </p>
              </div>
              <Switch
                id="chat-relay-enabled"
                checked={enabled}
                onCheckedChange={(value) => {
                  setTouched(true);
                  setEnabled(value);
                }}
                data-testid="switch-chat-relay-enabled"
              />
            </div>

            {enableBlocked && (
              <div
                className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                data-testid="text-chat-relay-blocked"
              >
                <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{data.enableBlockedReason}</span>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="chat-relay-grace">Grace period (days)</Label>
                <Input
                  id="chat-relay-grace"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={graceDays}
                  onChange={(e) => {
                    setTouched(true);
                    setGraceDays(e.target.value);
                  }}
                  aria-invalid={graceInvalid}
                  data-testid="input-chat-relay-grace"
                />
                <p className={`text-xs ${graceInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                  {graceInvalid
                    ? "Enter a whole number from 1 to 365."
                    : "Wait this long after send even when everyone has stored the media."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="chat-relay-expiry">Hard expiry (days)</Label>
                <Input
                  id="chat-relay-expiry"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={3650}
                  value={expiryDays}
                  onChange={(e) => {
                    setTouched(true);
                    setExpiryDays(e.target.value);
                  }}
                  aria-invalid={expiryInvalid}
                  data-testid="input-chat-relay-expiry"
                />
                <p className={`text-xs ${expiryInvalid ? "text-destructive" : "text-muted-foreground"}`}>
                  {expiryInvalid
                    ? "Enter a whole number from 1 to 3650 that is not shorter than the grace period."
                    : "Media nobody collected is removed after this many days regardless."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!dirty || graceInvalid || expiryInvalid || enableBlocked || update.isPending}
                data-testid="button-save-chat-relay"
              >
                {update.isPending && <Spinner className="mr-2" size={16} label={null} />}
                Save
              </Button>
              {dirty && !update.isPending && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTouched(false);
                    setEnabled(data.enabled);
                    setGraceDays(String(data.graceDays));
                    setExpiryDays(String(data.expiryDays));
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => run.mutate()}
                disabled={run.isPending || !data.enabled || dirty}
                title={
                  !data.enabled
                    ? "Switch the purge on and save first."
                    : dirty
                      ? "Save or cancel your changes first."
                      : undefined
                }
                data-testid="button-run-chat-relay"
              >
                {run.isPending && <Spinner className="mr-2" size={16} label={null} />}
                Run now
              </Button>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2" data-testid="text-chat-relay-last-run">
              {lastRun ? (
                <>
                  <p>
                    Last run {format(new Date(lastRun.ranAt), "d MMM yyyy, h:mm a")}:{" "}
                    {lastRun.skipped ? (
                      <span className="text-muted-foreground">
                        skipped — {lastRun.skippedReason}
                        {(lastRun.tombstonesPurged ?? 0) > 0
                          ? ` (still removed ${lastRun.tombstonesPurged} deleted-message file${lastRun.tombstonesPurged === 1 ? "" : "s"}, ${formatBytes(lastRun.bytesReclaimed)})`
                          : null}
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">{formatBytes(lastRun.bytesReclaimed)}</span>{" "}
                        reclaimed · {lastRun.purged} purged · {lastRun.expired} expired ·{" "}
                        {lastRun.tombstonesPurged ?? 0} deleted-message files ·{" "}
                        {lastRun.alreadyGone} already gone · {lastRun.kept} kept ·{" "}
                        {lastRun.examined} examined
                      </>
                    )}
                  </p>
                  {lastRun.abortedError && (
                    <p className="text-xs text-destructive">
                      Stopped early on a storage error and left the remaining rows untouched:{" "}
                      {lastRun.abortedError}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">The purge has not run yet.</p>
              )}
              {data.updatedAt && (
                <p className="text-xs text-muted-foreground">
                  Settings last changed {format(new Date(data.updatedAt), "d MMM yyyy, h:mm a")}
                  {data.updatedByName ? ` by ${data.updatedByName}` : ""}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
