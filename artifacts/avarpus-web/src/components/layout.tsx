import { Link, useLocation } from "wouter";
import { 
  Activity, 
  Wrench, 
  Users, 
  Package, 
  ShoppingCart, 
  CreditCard, 
  LineChart, 
  PieChart, 
  UserCog, 
  CheckSquare, 
  Bell, 
  Store, 
  RotateCcw, 
  MessageSquare, 
  Settings,
  LogOut,
  Menu
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";
import { Button } from "./ui/button";
import { FullPageLoader } from "@/components/ui/spinner";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: Activity },
  { href: "/repairs", label: "Repairs", icon: Wrench, feature: "repairs" },
  { href: "/customers", label: "Customers", icon: Users, feature: "customers" },
  { href: "/chats", label: "Inbox", icon: MessageSquare, feature: "chat" },
  { href: "/inventory", label: "Inventory", icon: Package, feature: "inventory" },
  { href: "/purchases", label: "Purchases", icon: ShoppingCart, feature: "purchases" },
  { href: "/returns", label: "Returns", icon: RotateCcw, feature: "repairs_update" },
  { href: "/payments", label: "Payments", icon: CreditCard, feature: "payments" },
  { href: "/finance", label: "Finance", icon: PieChart, feature: "finance" },
  { href: "/reports", label: "Reports", icon: LineChart, feature: "reports" },
  { href: "/staff", label: "Staff", icon: UserCog, feature: "staff" },
  { href: "/approvals", label: "Approvals", icon: CheckSquare, feature: "approvals" },
  { href: "/notifications", label: "Notifications", icon: Bell, feature: "notifications" },
  { href: "/dealers", label: "Dealers", icon: Store, feature: "dealers" },
  { href: "/settings", label: "Settings", icon: Settings, feature: "settings" },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading, logout, canAccess } = useAuth();
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isCustomer = user?.role === "customer";

  if (isLoading) {
    return <FullPageLoader />;
  }

  if (!isAuthenticated) {
    return null; // Will redirect via wouter Switch wrapping this
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Mobile sidebar toggle */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-sidebar border-b border-sidebar-border z-20 flex items-center justify-between px-4">
        <div className="font-bold text-lg text-sidebar-foreground">Avarpus</div>
        <Button variant="ghost" size="icon" className="text-sidebar-foreground" onClick={() => setSidebarOpen(!sidebarOpen)}>
          <Menu className="h-6 w-6" />
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:static inset-y-0 left-0 z-10 w-64 bg-sidebar border-r border-sidebar-border transform transition-transform duration-200 ease-in-out md:transform-none flex flex-col",
        sidebarOpen ? "translate-x-0 pt-16" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="hidden md:flex h-16 items-center px-6 border-b border-sidebar-border">
          <div className="font-bold text-xl text-sidebar-foreground tracking-tight flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center text-primary-foreground text-sm">A</div>
            Avarpus
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {NAV_ITEMS.filter(
              item =>
                (!isCustomer || item.href === "/chats" || item.href === "/settings") &&
                (!item.feature || canAccess(item.feature)),
            ).map((item) => {
              const active = location.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}>
                  <div className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer text-sm font-medium",
                    active 
                      ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}>
                    <item.icon className="h-4 w-4" />
                    {isCustomer && item.href === "/settings" ? "Profile" : item.label}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-md">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sidebar-accent-foreground font-semibold text-xs">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sidebar-foreground truncate">{user?.name}</div>
              <div className="text-xs text-sidebar-foreground/60 capitalize">{user?.role.replace('_', ' ')}</div>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" 
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden pt-16 md:pt-0 bg-muted/30">
        <div className="flex-1 overflow-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
