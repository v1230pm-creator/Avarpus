import { useState } from "react";
import { useInventoryList, useInventoryCreate, getInventoryListQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export function InventoryPage() {
  const [search, setSearch] = useState("");
  const { data: inventoryData, isLoading } = useInventoryList({ query: { queryKey: ["inventoryList", search] } });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [formData, setFormData] = useState({ 
    name: "", category: "", brand: "", quantity: "0", minStock: "0", purchasePrice: "0", sellingPrice: "0" 
  });

  const createItem = useInventoryCreate({
    mutation: {
      onSuccess: () => {
        toast({ title: "Item added", description: "Successfully added to inventory." });
        queryClient.invalidateQueries({ queryKey: getInventoryListQueryKey() });
        setIsCreateOpen(false);
        setFormData({ name: "", category: "", brand: "", quantity: "0", minStock: "0", purchasePrice: "0", sellingPrice: "0" });
      },
      onError: (err: any) => {
        toast({ title: "Failed to add", description: err.message || "An error occurred", variant: "destructive" });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createItem.mutate({ 
      data: {
        name: formData.name,
        category: formData.category,
        brand: formData.brand,
        quantity: Number(formData.quantity) || 0,
        minStock: Number(formData.minStock) || 0,
        purchasePrice: Number(formData.purchasePrice) || 0,
        sellingPrice: Number(formData.sellingPrice) || 0,
      } 
    });
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">Manage parts, accessories, and stock.</p>
        </div>
        
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Add Inventory Item</DialogTitle>
                <DialogDescription>Create a new item in your inventory.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4 grid-cols-2">
                <div className="space-y-2 col-span-2">
                  <Label>Name *</Label>
                  <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Brand</Label>
                  <Input value={formData.brand} onChange={e => setFormData({ ...formData, brand: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Quantity *</Label>
                  <Input type="number" min="0" value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label>Min Stock</Label>
                  <Input type="number" min="0" value={formData.minStock} onChange={e => setFormData({ ...formData, minStock: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Purchase Price</Label>
                  <Input type="number" min="0" step="0.01" value={formData.purchasePrice} onChange={e => setFormData({ ...formData, purchasePrice: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Selling Price *</Label>
                  <Input type="number" min="0" step="0.01" value={formData.sellingPrice} onChange={e => setFormData({ ...formData, sellingPrice: e.target.value })} required />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={createItem.isPending}>Cancel</Button>
                <Button type="submit" disabled={createItem.isPending}>
                  {createItem.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search items..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Item Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : inventoryData?.items.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No items found.</TableCell></TableRow>
              ) : (
                inventoryData?.items
                  .filter((item: any) => search === "" || item.name.toLowerCase().includes(search.toLowerCase()))
                  .map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell className="text-right font-medium">{item.quantity}</TableCell>
                    <TableCell className="text-right">₹{item.sellingPrice.toLocaleString()}</TableCell>
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
