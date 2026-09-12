import { useState } from "react";
import { useReturnsList } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { SectionLoader } from "@/components/ui/spinner";

export function ReturnsPage() {
  const { data, isLoading } = useReturnsList();

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Returns</h1>
          <p className="text-muted-foreground">Manage warranty returns and after-sales cases.</p>
        </div>
      </div>
      
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Return ID</TableHead>
                <TableHead>Repair Ref</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6}><SectionLoader className="py-8" /></TableCell></TableRow>
              ) : data?.returns.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No returns found.</TableCell></TableRow>
              ) : (
                data?.returns.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.returnId}</TableCell>
                    <TableCell className="text-muted-foreground">{item.repairTicket}</TableCell>
                    <TableCell>{item.customerName}</TableCell>
                    <TableCell className="max-w-xs truncate">{item.reason}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{item.status.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{format(new Date(item.returnDate), 'MMM d, yyyy')}</TableCell>
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
