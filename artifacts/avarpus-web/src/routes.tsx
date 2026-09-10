import { useAuth } from "@/lib/auth";
import { Redirect, Route, Switch, useLocation } from "wouter";
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
import { ComponentType, useState } from "react";
import { Button } from "@/components/ui/button";
import { LockKeyhole } from "lucide-react";

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

function DealerInactivePage() {
  const { logout, retryDealerPortal } = useAuth();
  const [, setLocation] = useLocation();
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      await retryDealerPortal();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          <LockKeyhole className="h-7 w-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Dealer portal is inactive</h1>
        <p className="mt-3 text-muted-foreground">
          Your shop has disabled access to this dealer portal. No repair information is available while access is inactive.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          If the shop reactivates your access, retry to continue without signing in again.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={retry} disabled={retrying}>{retrying ? "Checking..." : "Retry access"}</Button>
          <Button variant="outline" onClick={() => setLocation("/settings")}>Manage account</Button>
        </div>
        <Button className="mt-3" variant="ghost" onClick={logout}>Sign out</Button>
      </div>
    </main>
  );
}

export function ProtectedRoutes() {
  const { isAuthenticated, isLoading, user, dealerPortalInactive } = useAuth();
  const [location] = useLocation();

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

  if (user?.needsDisplayName) {
    return <Redirect to="/verify?setup=display-name" />;
  }

  if (dealerPortalInactive && location !== "/settings") {
    return <DealerInactivePage />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/dashboard"><ProtectedRoute component={DashboardPage} feature="dashboard" /></Route>
        <Route path="/repairs"><ProtectedRoute component={RepairsPage} feature="repairs" /></Route>
        <Route path="/customers"><ProtectedRoute component={CustomersPage} feature="customers" /></Route>
        <Route path="/inventory"><ProtectedRoute component={InventoryPage} feature="inventory" /></Route>
        <Route path="/purchases"><ProtectedRoute component={PurchasesPage} feature="purchases" /></Route>
        <Route path="/returns"><ProtectedRoute component={ReturnsPage} feature="repairs_update" /></Route>
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
