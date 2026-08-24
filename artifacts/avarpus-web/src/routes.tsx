import { useAuth } from "@/lib/auth";
import { Redirect, Route, Switch } from "wouter";
import { Layout } from "@/components/layout";

import { DashboardPage } from "@/pages/dashboard";
import { RepairsPage } from "@/pages/repairs";
import { CustomersPage } from "@/pages/customers";
import { InventoryPage } from "@/pages/inventory";
import { PurchasesPage } from "@/pages/purchases";
import { ReturnsPage } from "@/pages/returns";
import { PaymentsPage } from "@/pages/payments";
import { FinancePage } from "@/pages/finance";
import { ReportsPage } from "@/pages/reports";
import { StaffPage } from "@/pages/staff";
import { ApprovalsPage } from "@/pages/approvals";
import { NotificationsPage } from "@/pages/notifications";
import { DealersPage } from "@/pages/dealers";
import { SettingsPage } from "@/pages/settings";
import { ChatsPage } from "@/pages/chats";
import { ComponentType } from "react";

function ProtectedRoute({ component: Component, feature }: { component: ComponentType<any>, feature?: string }) {
  const { canAccess } = useAuth();
  
  if (feature && !canAccess(feature)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-2">Access Denied</h1>
        <p className="text-muted-foreground mb-6">You do not have permission to view this page.</p>
      </div>
    );
  }
  
  return <Component />;
}

function PortalNotice() {
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">
      <h1 className="text-3xl font-bold tracking-tight">Dealer portal</h1>
      <p className="mt-3 text-muted-foreground">
        Repair records for dealer portal accounts are currently available in the Avarpus mobile app.
      </p>
    </div>
  );
}

function AccountLanding() {
  const { canAccess } = useAuth();

  if (canAccess("dashboard")) return <Redirect to="/dashboard" />;
  if (canAccess("chat")) return <Redirect to="/chats" />;
  if (canAccess("repairs_portal")) return <Redirect to="/portal/repairs" />;
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <h1 className="text-4xl font-bold tracking-tight mb-2">Access Denied</h1>
      <p className="text-muted-foreground">This account has no enabled web workspace features.</p>
    </div>
  );
}

export function ProtectedRoutes() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/dashboard"><ProtectedRoute component={DashboardPage} feature="dashboard" /></Route>
        <Route path="/repairs"><ProtectedRoute component={RepairsPage} feature="repairs" /></Route>
        <Route path="/customers"><ProtectedRoute component={CustomersPage} feature="customers" /></Route>
        <Route path="/inventory"><ProtectedRoute component={InventoryPage} feature="inventory" /></Route>
        <Route path="/purchases"><ProtectedRoute component={PurchasesPage} feature="purchases" /></Route>
        <Route path="/returns"><ProtectedRoute component={ReturnsPage} feature="returns" /></Route>
        <Route path="/payments"><ProtectedRoute component={PaymentsPage} feature="payments" /></Route>
        <Route path="/finance"><ProtectedRoute component={FinancePage} feature="finance" /></Route>
        <Route path="/reports"><ProtectedRoute component={ReportsPage} feature="reports" /></Route>
        <Route path="/staff"><ProtectedRoute component={StaffPage} feature="staff" /></Route>
        <Route path="/approvals"><ProtectedRoute component={ApprovalsPage} feature="approvals" /></Route>
        <Route path="/notifications"><ProtectedRoute component={NotificationsPage} feature="notifications" /></Route>
        <Route path="/dealers"><ProtectedRoute component={DealersPage} feature="dealers" /></Route>
        <Route path="/settings"><ProtectedRoute component={SettingsPage} feature="settings" /></Route>
        <Route path="/chats"><ProtectedRoute component={ChatsPage} feature="chat" /></Route>
        <Route path="/portal/repairs">
          <ProtectedRoute component={PortalNotice} feature="repairs_portal" />
        </Route>
        <Route path="/">
          <AccountLanding />
        </Route>
        <Route>
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h1 className="text-4xl font-bold tracking-tight mb-2">404</h1>
            <p className="text-muted-foreground mb-6">This page doesn't exist.</p>
          </div>
        </Route>
      </Switch>
    </Layout>
  );
}
