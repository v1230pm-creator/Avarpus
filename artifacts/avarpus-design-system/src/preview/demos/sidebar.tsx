import { ClipboardList, IndianRupee, Package, Search, Settings, Users } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '../../components/ui/sidebar';
import { Guidelines, Stack } from '../parts';

// The real sidebar is position: fixed and viewport-tall. Inside the style guide
// it is bounded to this frame: the container becomes the positioning context
// and the fixed rail is pinned to it instead of the page.
const FRAME_CLASS =
  'relative h-[480px] overflow-hidden rounded-lg border ' +
  '[&_[data-slot=sidebar-container]]:absolute [&_[data-slot=sidebar-container]]:h-full';

export function SidebarDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Workshop shell (expanded, collapsible to icons)">
        <div className={FRAME_CLASS}>
          <SidebarProvider defaultOpen className="h-full min-h-0">
            <Sidebar collapsible="icon">
              <SidebarHeader>
                <SidebarInput placeholder="Search repairs" />
              </SidebarHeader>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Workshop</SidebarGroupLabel>
                  <SidebarGroupAction aria-label="Search">
                    <Search />
                  </SidebarGroupAction>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton isActive tooltip="Repairs">
                          <ClipboardList />
                          <span>Repairs</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge>12</SidebarMenuBadge>
                        <SidebarMenuSub>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton isActive>Repairing</SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton>Ready for pickup</SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        </SidebarMenuSub>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip="Customers">
                          <Users />
                          <span>Customers</span>
                        </SidebarMenuButton>
                        <SidebarMenuAction aria-label="Customer actions">
                          <span aria-hidden="true">•••</span>
                        </SidebarMenuAction>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip="Inventory">
                          <Package />
                          <span>Inventory</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                      <SidebarMenuItem>
                        <SidebarMenuButton tooltip="Payments">
                          <IndianRupee />
                          <span>Payments</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
                <SidebarSeparator />
              </SidebarContent>
              <SidebarFooter>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton tooltip="Settings">
                      <Settings />
                      <span>Settings</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarFooter>
              <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-h-0">
              <header className="flex h-14 items-center gap-3 border-b px-4">
                <SidebarTrigger />
                <strong>Repair dashboard</strong>
              </header>
              <div className="p-6">
                <p className="font-medium">RP-1042 · iPhone 13</p>
                <p className="text-sm text-muted-foreground">Anita Sharma · ₹2,400 due</p>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </Stack>

      <Stack label="Menu button variants and sizes">
        <div className="max-w-xs rounded-lg bg-sidebar p-3 text-sidebar-foreground">
          <SidebarProvider className="h-auto min-h-0">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="sm">
                  <ClipboardList />
                  <span>Small</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton>
                  <ClipboardList />
                  <span>Default</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg">
                  <ClipboardList />
                  <span>Large</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton variant="outline">
                  <ClipboardList />
                  <span>Outline</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>
                  <ClipboardList />
                  <span>Active</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarProvider>
        </div>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Keep the rail on the ink-navy sidebar surface with the brand blue reserved for the active item.',
            },
            {
              kind: 'dont',
              text: 'Do not put a second primary-blue control inside the rail; the active route is the only emphasis.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
