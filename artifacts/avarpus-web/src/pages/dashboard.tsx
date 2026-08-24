import { useDashboardStats, useDailyRepairsStats } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock, ShoppingBag, Users, Wrench } from "lucide-react";

export function DashboardPage() {
  const { data, isLoading } = useDashboardStats();
  const stats = data?.stats;

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded-md mb-6" />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="h-4 w-24 bg-muted rounded" />
                <div className="h-4 w-4 bg-muted rounded" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 bg-muted rounded mb-1" />
                <div className="h-3 w-32 bg-muted rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">Here's what's happening in your shop today.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Repairs Today</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.todayRepairs || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Devices received today
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Pending Repairs</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.pendingRepairs || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Currently in progress
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Ready for Pickup</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.readyForPickup || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Waiting for customer
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalCustomers || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              In your database
            </p>
          </CardContent>
        </Card>
      </div>

      {stats?.canSeeFinance && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Today's Income</CardTitle>
              <div className="h-4 w-4 text-emerald-500 font-bold">₹</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">₹{(stats.todayIncome || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Today's Expense</CardTitle>
              <div className="h-4 w-4 text-rose-500 font-bold">₹</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-rose-600">₹{(stats.todayExpense || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
              <div className="h-4 w-4 text-amber-500 font-bold">₹</div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">₹{(stats.pendingPayments || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
