import { useState } from "react";
import { useCustomersList, useCustomersCreate, getCustomersListQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";

export function CustomersPage() {
  const [search, setSearch] = useState("");
  const { data: customersData, isLoading } = useCustomersList({ query: { queryKey: ["customersList", search] } });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", mobile: "", email: "", address: "" });

  const createCustomer = useCustomersCreate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Customer created", description: "Successfully added new customer." });
        queryClient.invalidateQueries({ queryKey: getCustomersListQueryKey() });
        setIsCreateOpen(false);
        setFormData({ name: "", mobile: "", email: "", address: "" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to create", description: err.message || "An error occurred", variant: "destructive" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.mobile) {
      toast({ title: "Validation error", description: "Name and mobile are required.", variant: "destructive" });
      return;
    }
    createCustomer.mutate({ data: formData });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">Manage your customer database and histories.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Customer</DialogTitle>
                <DialogDescription>Create a new customer profile.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Mobile *</Label>
                  <Input value={formData.mobile} onChange={e => setFormData({ ...formData, mobile: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createCustomer.isPending}>Cancel</Button>
                <Button type="submit" disabled={createCustomer.isPending}>
                  {createCustomer.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search name, phone, email..."
            className="pl-8"
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
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Repairs</TableHead>
                <TableHead className="text-right">Due Amount</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-muted rounded animate-pulse" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 w-8 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 w-24 bg-muted rounded animate-pulse ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : customersData?.customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No customers found.
                  </TableCell>
                </TableRow>
              ) : (
                customersData?.customers
                  .filter((c: any) => search === "" || c.name.toLowerCase().includes(search.toLowerCase()) || c.mobile.includes(search))
                  .map((customer: any) => (
                  <TableRow key={customer.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>
                      <div>{customer.mobile}</div>
                      {customer.email && <div className="text-xs text-muted-foreground">{customer.email}</div>}
                    </TableCell>
                    <TableCell className="text-right">{customer.totalRepairs}</TableCell>
                    <TableCell className="text-right font-medium text-amber-600">
                      {customer.dueAmount > 0 ? `₹${customer.dueAmount.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {format(new Date(customer.createdAt), 'MMM d, yyyy')}
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
