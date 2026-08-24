import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users } from "lucide-react";

export function ReportsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Business insights and exportable data.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <TrendingUp className="w-8 h-8 text-primary mb-2" />
            <CardTitle>Financial Summary</CardTitle>
            <CardDescription>Monthly revenue, expenses, and profit margins.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Financial data is available in the Finance workspace.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <BarChart3 className="w-8 h-8 text-primary mb-2" />
            <CardTitle>Repair Performance</CardTitle>
            <CardDescription>Turnaround times, completion rates, and parts usage.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Repair status and workload are available in Repairs.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Users className="w-8 h-8 text-primary mb-2" />
            <CardTitle>Customer Analytics</CardTitle>
            <CardDescription>Retention, top spenders, and acquisition channels.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Customer activity is available in Customers.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
