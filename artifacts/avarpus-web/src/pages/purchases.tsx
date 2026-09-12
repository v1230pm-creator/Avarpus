import { useState } from "react";
import { usePurchasesList } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { SectionLoader } from "@/components/ui/spinner";

export function PurchasesPage() {
  const [search, setSearch] = useState("");
  // Whole-list endpoint: filter in the browser and keep the search term out of
  // the query key so typing does not re-fetch the same rows repeatedly.
  const { data, isLoading } = usePurchasesList();

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchases</h1>
          <p className="text-muted-foreground">Manage inventory purchases and supplier invoices.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search invoices, suppliers..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4}><SectionLoader className="py-8" /></TableCell></TableRow>
              ) : data?.purchases.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="h-32 text-center text-muted-foreground">No purchases found.</TableCell></TableRow>
              ) : (
                data?.purchases
                  .filter((item: any) => search === "" || item.invoiceNo.toLowerCase().includes(search.toLowerCase()) || item.supplier.toLowerCase().includes(search.toLowerCase()))
                  .map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.invoiceNo}</TableCell>
                    <TableCell>{item.supplier}</TableCell>
                    <TableCell>{format(new Date(item.date), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right font-medium">₹{item.total.toLocaleString()}</TableCell>
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
