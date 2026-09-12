import { useState } from "react";
import { useDealersList } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search } from "lucide-react";
import { SectionLoader, Spinner } from "@/components/ui/spinner";

export function DealersPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading, isFetching } = useDealersList({ q: search }, { query: { queryKey: ["dealers", search] } });
  const searchBusy = isFetching && search.trim().length > 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dealers</h1>
          <p className="text-muted-foreground">Manage B2B wholesale clients.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <span className="pointer-events-none absolute left-8 top-2.5 flex size-4 items-center justify-center">{searchBusy ? <Spinner size={14} label={null} /> : null}</span>
          <Input type="search" placeholder="Search..." className="pl-14" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name / Shop</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="text-right">Total Repairs</TableHead>
                <TableHead className="text-right">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5}><SectionLoader className="py-8" /></TableCell></TableRow>
              ) : data?.dealers.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="h-32 text-center text-muted-foreground">No dealers found.</TableCell></TableRow>
              ) : (
                data?.dealers.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.dealerCode}</TableCell>
                    <TableCell className="font-medium">
                      <div>{item.name}</div>
                      {item.shopName && <div className="text-xs text-muted-foreground">{item.shopName}</div>}
                    </TableCell>
                    <TableCell>
                      <div>{item.mobile}</div>
                      {item.location && <div className="text-xs text-muted-foreground">{item.location}</div>}
                    </TableCell>
                    <TableCell className="text-right">{item.totalRepairs}</TableCell>
                    <TableCell className="text-right">{item.repairing}</TableCell>
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
