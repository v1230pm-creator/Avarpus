import * as React from "react"
import { Link, useLocation } from "wouter"
import {
  useAuthMe,
  useAuthLogout,
  useNotificationsList,
  useNotificationsMarkRead,
} from "@workspace/api-client-react"
import {
  LogOut,
  LayoutDashboard,
  PackageSearch,
  PlusCircle,
  Menu,
  X,
  Inbox,
  MessageSquareWarning,
  Bell,
  Settings as SettingsIcon
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { AvarpusLogo } from "@/components/AvarpusLogo"

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation()
  const { data: me } = useAuthMe()
  const logout = useAuthLogout()
  const { data: notificationData, refetch: refetchNotifications } = useNotificationsList({
    query: { refetchInterval: 30_000 },
  } as any)
  const markNotificationRead = useNotificationsMarkRead({
    mutation: { onSuccess: () => refetchNotifications() },
  })
  const [sidebarOpen, setSidebarOpen] = React.useState(false)
  const requestAlerts = (notificationData?.notifications ?? [])
    .filter((notification) =>
      notification.type === "public_request_received" &&
      !notification.read &&
      typeof (notification.data as Record<string, unknown>).href === "string"
    )
    .slice(0, 3)

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/public-requests", label: "Public Requests", icon: Inbox },
    { href: "/chat-reports", label: "Chat Reports", icon: MessageSquareWarning },
    { href: "/releases", label: "Releases", icon: PackageSearch },
    { href: "/releases/new", label: "New Release", icon: PlusCircle },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ]

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        localStorage.removeItem("auth_token")
        window.location.href = "/login"
      }
    })
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <AvarpusLogo className="h-9 w-9 rounded-full" />
          <span>Avarpus Update Admin</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} className="text-sidebar-foreground">
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 flex flex-col",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
          <div className="p-5 hidden md:flex items-center gap-3">
           <AvarpusLogo className="h-11 w-11 rounded-full" />
           <span className="font-bold text-lg tracking-tight">Avarpus Admin</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href))
            return (
              <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}>
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer group",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}>
                  <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70")} />
                  {item.label}
                </div>
              </Link>
            )
          })}

          {requestAlerts.length > 0 && (
            <div className="mt-6 border-t border-sidebar-border pt-4">
              <div className="flex items-center gap-2 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                <Bell className="h-3.5 w-3.5" />
                New request alerts
              </div>
              <div className="space-y-1">
                {requestAlerts.map((notification) => {
                  const href = (notification.data as Record<string, unknown>).href as string
                  return (
                    <Link
                      key={notification.id}
                      href={href}
                      onClick={() => {
                        setSidebarOpen(false)
                        markNotificationRead.mutate({ data: { ids: [notification.id] } })
                      }}
                    >
                      <div className="cursor-pointer rounded-md bg-sidebar-accent/50 px-3 py-2 hover:bg-sidebar-accent">
                        <div className="text-sm font-medium">{notification.title}</div>
                        <div className="mt-0.5 text-xs text-sidebar-foreground/60">
                          {notification.body}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center font-semibold text-xs">
              {me?.user?.name?.charAt(0) || "A"}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium leading-none">{me?.user?.name || "Admin"}</span>
              <span className="text-xs text-sidebar-foreground/50 mt-1">{me?.user?.email}</span>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-[100dvh] overflow-hidden">
        {children}
      </main>
      
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  )
}
