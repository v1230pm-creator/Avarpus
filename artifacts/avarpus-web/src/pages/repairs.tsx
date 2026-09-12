import { useState } from "react";
import { useRepairsList, useRepairsCreate, getRepairsListQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Spinner } from "@/components/ui/spinner";

export function RepairsPage() {
  const [search, setSearch] = useState("");
  const { data: repairsData, isLoading, isFetching } = useRepairsList({ q: search }, { query: { queryKey: ["repairsList", search] } });
  const searchBusy = isFetching && search.trim().length > 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canAccess } = useAuth();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState({ 
    customerName: "", mobile: "", deviceType: "", brand: "", model: "", problem: "" 
  });

  const createRepair = useRepairsCreate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Repair created", description: "Successfully created new repair ticket." });
        queryClient.invalidateQueries({ queryKey: getRepairsListQueryKey() });
        setIsCreateOpen(false);
        setFormData({ customerName: "", mobile: "", deviceType: "", brand: "", model: "", problem: "" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to create", description: err.message || "An error occurred", variant: "destructive" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerName || !formData.mobile || !formData.deviceType || !formData.brand || !formData.model || !formData.problem) {
      toast({ title: "Validation error", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    createRepair.mutate({ data: formData });
  };

  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'received': return <Badge variant="secondary">Received</Badge>;
      case 'in_progress': return <Badge variant="warning">In Progress</Badge>;
      case 'ready': return <Badge variant="success">Ready</Badge>;
      case 'delivered': return <Badge variant="default">Delivered</Badge>;
      case 'cancelled': return <Badge variant="destructive">Cancelled</Badge>;
      default: return <Badge variant="outline">{status.replace('_', ' ')}</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Repairs</h1>
          <p className="text-muted-foreground">Manage active and historical repair tickets.</p>
        </div>
        
        {canAccess("repairs_create") && <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Repair
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>New Repair Ticket</DialogTitle>
                <DialogDescription>Enter customer and device details to start a repair.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>Customer Name *</Label>
                  <Input value={formData.customerName} onChange={e => setFormData({ ...formData, customerName: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Mobile Number *</Label>
                  <Input value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Device Type *</Label>
                  <Input placeholder="e.g. Smartphone, Laptop" value={formData.deviceType} onChange={e => setFormData({ ...formData, deviceType: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Brand *</Label>
                  <Input value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Model *</Label>
                  <Input value={formData.model} onChange={e => setFormData({ ...formData, model: e.target.value })} required />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label>Problem Description *</Label>
                  <Input value={formData.problem} onChange={e => setFormData({ ...formData, problem: e.target.value })} required />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createRepair.isPending}>Cancel</Button>
                <Button type="submit" disabled={createRepair.isPending}>
                  {createRepair.isPending ? "Creating..." : "Create Ticket"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <span className="pointer-events-none absolute left-8 top-2.5 flex size-4 items-center justify-center">{searchBusy ? <Spinner size={14} label={null} /> : null}</span>
          <Input
            type="search"
            placeholder="Search tickets, customers, devices..."
            className="pl-14"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-[100px]">Ticket</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 w-16 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-20 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 w-24 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : repairsData?.repairs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    No repairs found.
                  </TableCell>
                </TableRow>
              ) : (
                repairsData?.repairs.map((repair: any) => (
                  <TableRow key={repair.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{repair.repairId}</TableCell>
                    <TableCell>
                      <div>{repair.customerName}</div>
                      <div className="text-xs text-muted-foreground">{repair.mobile}</div>
                    </TableCell>
                    <TableCell>
                      <div>{repair.brand} {repair.model}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{repair.problem}</div>
                    </TableCell>
                    <TableCell>{getStatusBadge(repair.status)}</TableCell>
                    <TableCell className="text-right font-medium">₹{repair.totalAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(repair.createdAt), 'MMM d, yyyy')}
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
