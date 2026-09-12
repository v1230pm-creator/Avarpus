import { useState } from "react";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import {
  type PublicRequestStatus,
  usePublicRequestAdminGet,
  usePublicRequestAdminIdentityVerificationCreate,
  usePublicRequestAdminStatusUpdate,
  getPublicRequestAdminGetQueryKey,
  getPublicRequestAdminListQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionLoader, Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { 
  ArrowLeft, User, Phone, Mail, FileText,
  ShieldAlert, Clock, CheckCircle2, XCircle, AlertTriangle,
  Send, History, ShieldCheck
} from "lucide-react";

export default function PublicRequestDetail() {
  const params = useParams();
  const id = params?.id as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data, isLoading, error } = usePublicRequestAdminGet(id);
  const statusUpdate = usePublicRequestAdminStatusUpdate();
  const identityVerificationCreate = usePublicRequestAdminIdentityVerificationCreate();

  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [updateAction, setUpdateAction] = useState<PublicRequestStatus | null>(null);
  const [note, setNote] = useState("");
  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const [verificationMethod, setVerificationMethod] = useState("");
  const [verificationNote, setVerificationNote] = useState("");

  if (isLoading) {
    return <SectionLoader className="flex-1" />;
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-xl font-bold">Request Not Found</h2>
        <p className="text-muted-foreground mt-2 mb-6">This request may have been removed or does not exist.</p>
        <Button asChild>
          <Link href="/public-requests">Back to Queue</Link>
        </Button>
      </div>
    );
  }

  const { request, transitions, identityVerification } = data;
  const isTerminal = request.status === "resolved" || request.status === "rejected";

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case "received": return { label: "Received", icon: Clock, color: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900" };
      case "in_review": return { label: "In Review", icon: Clock, color: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900" };
      case "resolved": return { label: "Resolved", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900" };
      case "rejected": return { label: "Rejected", icon: XCircle, color: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30 border-red-200 dark:border-red-900" };
      default: return { label: status, icon: Clock, color: "text-slate-600 bg-slate-50 border-slate-200" };
    }
  };

  const handleStatusUpdate = () => {
    if (!updateAction) return;

    statusUpdate.mutate(
      { id, data: { status: updateAction, note: note.trim() || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Status updated", description: `Request moved to ${updateAction.replace("_", " ")}.` });
          setIsUpdateOpen(false);
          setNote("");
          setUpdateAction(null);
          // Invalidate to refresh detail and list
          queryClient.invalidateQueries({ queryKey: getPublicRequestAdminGetQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getPublicRequestAdminListQueryKey() });
        },
        onError: () => {
          toast({ title: "Update failed", description: "Could not change the request status.", variant: "destructive" });
        }
      }
    );
  };

  const openUpdateDialog = (status: PublicRequestStatus) => {
    setUpdateAction(status);
    setIsUpdateOpen(true);
  };

  const handleIdentityVerification = () => {
    const method = verificationMethod.trim();
    const verificationDetails = verificationNote.trim();
    if (!method || !verificationDetails) return;

    identityVerificationCreate.mutate(
      { id, data: { method, note: verificationDetails } },
      {
        onSuccess: () => {
          toast({
            title: "Identity verification recorded",
            description: "The attributed verification record is now part of this request.",
          });
          setIsVerificationOpen(false);
          setVerificationMethod("");
          setVerificationNote("");
          queryClient.invalidateQueries({ queryKey: getPublicRequestAdminGetQueryKey(id) });
        },
        onError: () => {
          toast({
            title: "Verification could not be recorded",
            description: "Refresh the request and confirm it is still in review.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const currentStatusDisplay = getStatusDisplay(request.status);
  const StatusIcon = currentStatusDisplay.icon;

  return (
    <div className="flex-1 p-6 md:p-8 overflow-auto bg-slate-50/50 dark:bg-slate-950/50 min-h-screen animate-in fade-in duration-300">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2 mb-4">
            <Link href="/public-requests">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Queue
            </Link>
          </Button>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                Request Details
                <Badge variant="outline" className={`ml-2 text-sm px-2.5 py-0.5 ${currentStatusDisplay.color}`}>
                  <StatusIcon className="h-3.5 w-3.5 mr-1.5" />
                  {currentStatusDisplay.label}
                </Badge>
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                ID: <span className="font-mono">{request.id}</span>
              </p>
            </div>
            {!isTerminal && (
              <div className="flex gap-2">
                {request.status === "received" && (
                  <Button onClick={() => openUpdateDialog("in_review" as PublicRequestStatus)} variant="outline" className="bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-900/40">
                    Start Review
                  </Button>
                )}
                {request.status === "in_review" && (
                  <>
                    {request.kind === "account_deletion" && !identityVerification && (
                      <Button onClick={() => setIsVerificationOpen(true)} variant="outline">
                        <ShieldCheck className="h-4 w-4 mr-2" /> Verify identity
                      </Button>
                    )}
                    <Button
                      onClick={() => openUpdateDialog("resolved" as PublicRequestStatus)}
                      disabled={request.kind === "account_deletion" && !identityVerification}
                      title={request.kind === "account_deletion" && !identityVerification
                        ? "Record identity verification before resolving"
                        : undefined}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" /> Resolve
                    </Button>
                  </>
                )}
                <Button onClick={() => openUpdateDialog("rejected" as PublicRequestStatus)} variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  Reject
                </Button>
              </div>
            )}
          </div>
        </div>

        {request.kind === "account_deletion" && (
          <div className="mb-6 space-y-3">
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 rounded-lg p-5 flex gap-4">
            <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-800 dark:text-red-300">Account Deletion Request</h3>
              <p className="text-red-700/90 dark:text-red-400/90 text-sm mt-1 leading-relaxed">
                This is a formal request for data erasure. You must verify the user's identity through an approved out-of-band process before proceeding.
                <strong className="block mt-2">Changing the status of this ticket does NOT delete the account.</strong> 
                Only follow the approved account-deletion process after identity verification is complete, then record the outcome here.
              </p>
              {request.confirmationAcceptedAt && (
                <div className="mt-3 flex items-center text-xs font-medium text-red-800/80 dark:text-red-300/80">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" />
                  User accepted the deletion warning at {format(new Date(request.confirmationAcceptedAt), 'PP p')}
                </div>
              )}
            </div>
          </div>
          <div className={`rounded-lg border p-4 ${
            identityVerification
              ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              : "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
          }`}>
            {identityVerification ? (
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-300">Identity verification recorded</div>
                  <div className="mt-1 text-emerald-700 dark:text-emerald-400">
                    {identityVerification.method} · {identityVerification.reviewerName || "Super admin"} · {format(new Date(identityVerification.createdAt), "PP p")}
                  </div>
                  <div className="mt-2 text-emerald-800/90 dark:text-emerald-300/90">{identityVerification.note}</div>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Identity not yet verified</div>
                  <div className="mt-1">This deletion request cannot be resolved until attributed verification evidence is recorded.</div>
                </div>
              </div>
            )}
          </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Message Content
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                {request.subject && (
                  <div className="mb-4">
                    <div className="text-sm font-medium text-muted-foreground mb-1">Subject</div>
                    <div className="font-semibold text-lg">{request.subject}</div>
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-2">Message</div>
                  <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-md text-sm whitespace-pre-wrap leading-relaxed font-mono border border-slate-100 dark:border-slate-800">
                    {request.message}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Review History
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 dark:before:via-slate-800 before:to-transparent">
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background dark:border-background bg-slate-200 dark:bg-slate-800 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10">
                      <Clock className="h-4 w-4" />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-card shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold text-sm">Request Submitted</div>
                        <div className="text-xs text-muted-foreground">{format(new Date(request.createdAt), 'MMM d, HH:mm')}</div>
                      </div>
                      <div className="text-sm text-muted-foreground">Received from public form.</div>
                    </div>
                  </div>

                  {identityVerification && (
                    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-card shadow-sm">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-sm">Identity Verification Recorded</div>
                          <div className="text-xs text-muted-foreground">{format(new Date(identityVerification.createdAt), 'MMM d, HH:mm')}</div>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                          <User className="h-3 w-3" /> {identityVerification.reviewerName || 'Super admin'} · {identityVerification.method}
                        </div>
                        <div className="text-sm bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded border border-slate-100 dark:border-slate-800 mt-2">
                          {identityVerification.note}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {transitions.map((transition, i) => {
                    const TIcon = getStatusDisplay(transition.toStatus).icon;
                    return (
                      <div key={transition.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className={`flex items-center justify-center w-10 h-10 rounded-full border-4 border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 ${
                          transition.toStatus === 'resolved' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30' : 
                          transition.toStatus === 'rejected' ? 'bg-red-100 text-red-600 dark:bg-red-900/30' : 
                          'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                        }`}>
                          <TIcon className="h-4 w-4" />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-lg border border-slate-100 dark:border-slate-800 bg-card shadow-sm">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-semibold text-sm flex items-center gap-1.5">
                              {transition.toStatus === 'in_review' ? 'Review Started' : 
                               transition.toStatus === 'resolved' ? 'Marked Resolved' : 'Rejected'}
                            </div>
                            <div className="text-xs text-muted-foreground">{format(new Date(transition.createdAt), 'MMM d, HH:mm')}</div>
                          </div>
                          <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <User className="h-3 w-3" /> {transition.reviewerName || 'System'}
                          </div>
                          {transition.note && (
                            <div className="text-sm bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded border border-slate-100 dark:border-slate-800 italic mt-2">
                              "{transition.note}"
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Contact Info
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Name</div>
                  <div className="font-medium">{request.requesterName}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Mobile Number</div>
                  <div className="font-medium flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {request.mobile}
                  </div>
                </div>
                {request.email && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Email Address</div>
                    <div className="font-medium flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                      <a href={`mailto:${request.email}`} className="text-primary hover:underline">{request.email}</a>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="bg-slate-50/50 dark:bg-slate-900/20 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Received At</div>
                  <div className="text-sm font-medium">{format(new Date(request.createdAt), 'PPpp')}</div>
                </div>
                {request.reviewedAt && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Last Reviewed</div>
                    <div className="text-sm font-medium">{format(new Date(request.reviewedAt), 'PPpp')}</div>
                  </div>
                )}
                {isTerminal && transitions.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Closed At</div>
                    <div className="text-sm font-medium">{format(new Date(transitions[transitions.length - 1].createdAt), 'PPpp')}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={isUpdateOpen} onOpenChange={setIsUpdateOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {updateAction === 'in_review' ? 'Start Review' : 
               updateAction === 'resolved' ? 'Resolve Request' : 'Reject Request'}
            </DialogTitle>
            <DialogDescription>
              {updateAction === 'in_review' 
                ? 'Mark this request as actively being worked on by you.' 
                : 'Provide an internal note summarizing the outcome. This is permanently recorded in the history.'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="note" className="text-sm font-medium">
                Internal Note {updateAction === 'in_review' ? '(Optional)' : '(Recommended)'}
              </label>
              <Textarea
                id="note"
                placeholder={
                  updateAction === 'in_review' ? "e.g., Calling the customer now..." :
                   updateAction === 'resolved' ? "Summarize the approved outcome and any follow-up." :
                  "e.g., Spam submission, no action taken."
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
            
            {updateAction === 'resolved' && request.kind === 'account_deletion' && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800 dark:text-amber-400 leading-tight">
                  Remember: This action only closes the ticket. It does not perform the actual data deletion.
                </p>
              </div>
            )}
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsUpdateOpen(false)} disabled={statusUpdate.isPending}>
              Cancel
            </Button>
            <Button 
              onClick={handleStatusUpdate} 
              disabled={statusUpdate.isPending}
              variant={updateAction === 'rejected' ? 'destructive' : 'default'}
              className={updateAction === 'resolved' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {statusUpdate.isPending && <Spinner className="mr-2" size={16} label={null} />}
              {updateAction === 'in_review' ? 'Start Review' : 
               updateAction === 'resolved' ? 'Resolve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isVerificationOpen} onOpenChange={setIsVerificationOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Record identity verification</DialogTitle>
            <DialogDescription>
              Record only a verification you personally completed through an approved out-of-band process. This evidence is immutable.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label htmlFor="verification-method" className="text-sm font-medium">Verification method</label>
              <input
                id="verification-method"
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="e.g., Registered mobile callback"
                value={verificationMethod}
                onChange={(event) => setVerificationMethod(event.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="verification-note" className="text-sm font-medium">Verification evidence</label>
              <Textarea
                id="verification-note"
                placeholder="Record the non-sensitive evidence used to confirm identity."
                value={verificationNote}
                onChange={(event) => setVerificationNote(event.target.value)}
                rows={4}
                maxLength={2000}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">Do not include OTPs, passwords, or other secrets.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVerificationOpen(false)} disabled={identityVerificationCreate.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleIdentityVerification}
              disabled={identityVerificationCreate.isPending || !verificationMethod.trim() || !verificationNote.trim()}
            >
              {identityVerificationCreate.isPending && <Spinner className="mr-2" size={16} label={null} />}
              Record verification
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
