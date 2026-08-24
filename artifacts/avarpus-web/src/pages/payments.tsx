import { useState } from "react";
import { usePaymentsList } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { format } from "date-fns";

export function PaymentsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = usePaymentsList({}, { query: { queryKey: ["payments", search] } });

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">Customer repair payments and advances.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input type="search" placeholder="Search..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Repair ID</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow>
              ) : data?.payments.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No payments found.</TableCell></TableRow>
              ) : (
                data?.payments
                  .filter((item: any) => search === "" || item.repairId.toLowerCase().includes(search.toLowerCase()))
                  .map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.repairId}</TableCell>
                    <TableCell className="capitalize">{item.kind}</TableCell>
                    <TableCell>{item.method}</TableCell>
                    <TableCell>{format(new Date(item.createdAt), 'MMM d, yyyy')}</TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">+₹{item.amount.toLocaleString()}</TableCell>
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
