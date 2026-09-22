import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  getSupportNotificationSettingsGetQueryKey,
  useSupportNotificationSettingsGet,
  useSupportNotificationSettingsUpdate,
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
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { SignedInDevices } from "@/components/signed-in-devices";
import { ChatRelaySettings } from "@/components/chat-relay-settings";
import { ChatRelayTrend } from "@/components/chat-relay-trend";
import {
  AlertTriangle,
  CheckCircle2,
  Mail,
  MailX,
} from "lucide-react";

const EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>.]+(\.[^\s@,<>.]+)+$/;

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useSupportNotificationSettingsGet();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && data) setEmail(data.recipientEmail ?? "");
  }, [data, touched]);

  const update = useSupportNotificationSettingsUpdate({
    mutation: {
      onSuccess: (result) => {
        queryClient.setQueryData(
          getSupportNotificationSettingsGetQueryKey(),
          result,
        );
        setTouched(false);
        toast({
          title: result.recipientEmail
            ? "Support email saved"
            : "Support email removed",
          description: result.recipientEmail
            ? `${result.recipientEmail} is now published as the support contact address.`
            : "No support email is currently published.",
        });
      },
      onError: () => {
        toast({
          title: "Could not save",
          description: "Check the email address and try again.",
          variant: "destructive",
        });
      },
    },
  });

  const trimmed = email.trim();
  const invalid = trimmed.length > 0 && !EMAIL_PATTERN.test(trimmed);
  const dirty = trimmed !== (data?.recipientEmail ?? "");

  const handleSave = () => {
    if (invalid) return;
    update.mutate({ data: { recipientEmail: trimmed || null } });
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-auto">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Platform configuration for the Avarpus website and admin console.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Public support email
            </CardTitle>
            <CardDescription>
              This address is published on the website's support page, so use a
              mailbox you are happy for customers to see. New request alerts are
              delivered separately to active super administrators in this console.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner size={16} label={null} />
                Loading current setting...
              </div>
            ) : isError ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                Could not load the current setting. Reload the page to try again.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="support-email">Published contact address</Label>
                  <Input
                    id="support-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="support@avarpus.com"
                    value={email}
                    onChange={(e) => {
                      setTouched(true);
                      setEmail(e.target.value);
                    }}
                    aria-invalid={invalid}
                    data-testid="input-support-email"
                  />
                  {invalid ? (
                    <p className="text-xs text-destructive">
                      Enter a single valid email address.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Leave this empty to publish no support email address.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    onClick={handleSave}
                    disabled={!dirty || invalid || update.isPending}
                    data-testid="button-save-support-email"
                  >
                    {update.isPending && (
                      <Spinner className="mr-2" size={16} label={null} />
                    )}
                    Save
                  </Button>
                  {dirty && !update.isPending && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setTouched(false);
                        setEmail(data?.recipientEmail ?? "");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>

                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    {data?.recipientEmail ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>
                          Published support address:{" "}
                          <span className="font-medium">
                            {data.recipientEmail}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <MailX className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          No public support email is configured.
                        </span>
                      </>
                    )}
                  </div>
                  {data?.updatedAt && (
                    <p className="text-xs text-muted-foreground">
                      Last changed {format(new Date(data.updatedAt), "d MMM yyyy, h:mm a")}
                      {data.updatedByName ? ` by ${data.updatedByName}` : ""}
                    </p>
                  )}
                </div>

              </>
            )}
          </CardContent>
        </Card>

        <ChatRelaySettings />

        <ChatRelayTrend />

        <SignedInDevices />
      </div>
    </div>
  );
}
