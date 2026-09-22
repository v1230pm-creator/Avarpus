import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '../../components/ui/navigation-menu';
import { Row } from '../parts';
export function NavigationMenuDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Workshop navigation">
        <NavigationMenu defaultValue="repairs">
          <NavigationMenuList>
            <NavigationMenuItem value="repairs">
              <NavigationMenuTrigger>Repairs</NavigationMenuTrigger>
              <NavigationMenuContent>
                <div className="grid w-[360px] gap-2 p-4">
                  <NavigationMenuLink className="rounded-md p-3 hover:bg-muted">
                    <span className="block font-medium">Open repairs</span>
                    <span className="text-sm text-muted-foreground">
                      12 devices currently in service
                    </span>
                  </NavigationMenuLink>
                  <NavigationMenuLink className="rounded-md p-3 hover:bg-muted">
                    <span className="block font-medium">Ready for pickup</span>
                    <span className="text-sm text-muted-foreground">4 customers to notify</span>
                  </NavigationMenuLink>
                </div>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink className="px-4 py-2 text-sm font-medium" href="#customers">
                Customers
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink className="px-4 py-2 text-sm font-medium" href="#inventory">
                Inventory
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Row>
    </div>
  );
}
