import { useState } from "react";
import { useApprovalsList, useApprovalsApprove, useApprovalsReject, getApprovalsListQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ApprovalsPage() {
  const { data, isLoading } = useApprovalsList();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const approveMutation = useApprovalsApprove({
    mutation: {
      onSuccess: () => {
        toast({ title: "Approved", description: "The request has been approved." });
        queryClient.invalidateQueries({ queryKey: getApprovalsListQueryKey() });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    }
  });

  const rejectMutation = useApprovalsReject({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rejected", description: "The request has been rejected." });
        queryClient.invalidateQueries({ queryKey: getApprovalsListQueryKey() });
        setRejectingId(null);
        setRejectReason("");
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    }
  });

  const handleApprove = (id: string) => {
    approveMutation.mutate({ id });
  };

  const handleReject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingId || !rejectReason) return;
    rejectMutation.mutate({ id: rejectingId, data: { reason: rejectReason } });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
          <p className="text-muted-foreground">Review pending requests from staff.</p>
        </div>
      </div>
      
      <Dialog open={!!rejectingId} onOpenChange={(open) => !open && setRejectingId(null)}>
        <DialogContent>
          <form onSubmit={handleReject}>
            <DialogHeader>
              <DialogTitle>Reject Request</DialogTitle>
              <DialogDescription>Please provide a reason for rejecting this request.</DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input 
                value={rejectReason} 
                onChange={(e) => setRejectReason(e.target.value)} 
                placeholder="Reason for rejection..." 
                required 
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectingId(null)} disabled={rejectMutation.isPending}>Cancel</Button>
              <Button type="submit" variant="destructive" disabled={rejectMutation.isPending}>
                {rejectMutation.isPending ? "Rejecting..." : "Reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Requested By</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : data?.approvals.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No pending approvals.</TableCell></TableRow>
              ) : (
                data?.approvals.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="capitalize font-medium">{item.recordType} - {item.mode}</TableCell>
                    <TableCell>{item.requesterName}</TableCell>
                    <TableCell className="max-w-xs truncate">{item.reason}</TableCell>
                    <TableCell>
                      <Badge variant={item.status === 'pending' ? 'warning' : item.status === 'approved' ? 'success' : 'destructive'}>
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{format(new Date(item.requestedDate), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right space-x-2">
                      {item.status === 'pending' && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => setRejectingId(item.id)}>Reject</Button>
                          <Button size="sm" onClick={() => handleApprove(item.id)} disabled={approveMutation.isPending}>Approve</Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
