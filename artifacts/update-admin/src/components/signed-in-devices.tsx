import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  getAuthSessionsQueryKey,
  useAuthRevokeOtherSessions,
  useAuthRevokeSession,
  useAuthSessions,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { MonitorSmartphone, ShieldCheck } from "lucide-react";

function since(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

// Lists every session on the signed-in administrator's account and lets them
// revoke any device they do not recognise. Administrator sessions also lapse
// on their own after 30 days without activity; this card is the manual path.
export function SignedInDevices() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useAuthSessions();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getAuthSessionsQueryKey() });

  const revokeOne = useAuthRevokeSession({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Device signed out" });
      },
      onError: () => {
        toast({
          title: "Could not sign out that device",
          description: "It may already be signed out. Refresh and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const revokeOthers = useAuthRevokeOtherSessions({
    mutation: {
      onSuccess: (result) => {
        invalidate();
        toast({ title: result.message });
      },
      onError: () => {
        toast({
          title: "Could not sign out other devices",
          variant: "destructive",
        });
      },
    },
  });

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-5 w-5 text-primary" />
          Signed-in devices
        </CardTitle>
        <CardDescription>
          Every device currently holding a login for your administrator account.
          Sign out anything you do not recognise. Administrator logins also end
          automatically after 30 days without use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            Loading devices…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            Could not load your devices. Check your connection and refresh.
          </p>
        ) : (
          <>
            <ul className="divide-y rounded-md border" data-testid="signed-in-devices">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {s.deviceInfo || "Unknown device"}
                      </span>
                      {s.current && (
                        <Badge variant="secondary" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.current
                        ? `Signed in ${since(s.createdAt)}`
                        : `Last active ${since(s.lastSeenAt)} · signed in ${since(s.createdAt)}`}
                    </p>
                  </div>
                  {!s.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revokeOne.isPending && revokeOne.variables?.id === s.id}
                      onClick={() => revokeOne.mutate({ id: s.id })}
                    >
                      {revokeOne.isPending && revokeOne.variables?.id === s.id ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        "Sign out"
                      )}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {others.length > 0 && (
              <Button
                variant="destructive"
                disabled={revokeOthers.isPending}
                onClick={() => revokeOthers.mutate()}
              >
                {revokeOthers.isPending ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  `Sign out all other devices (${others.length})`
                )}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
