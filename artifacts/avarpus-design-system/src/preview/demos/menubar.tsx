import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '../../components/ui/menubar';
import { Row } from '../parts';
export function MenubarDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Workshop commands">
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>Repairs</MenubarTrigger>
            <MenubarContent>
              <MenubarLabel>Ticket</MenubarLabel>
              <MenubarItem>
                New intake<MenubarShortcut>⌘N</MenubarShortcut>
              </MenubarItem>
              <MenubarItem>Print receipt</MenubarItem>
              <MenubarSeparator />
              <MenubarCheckboxItem checked>Show delivered</MenubarCheckboxItem>
              <MenubarSub>
                <MenubarSubTrigger>Export</MenubarSubTrigger>
                <MenubarSubContent>
                  <MenubarItem>Repair list</MenubarItem>
                  <MenubarItem>Payments</MenubarItem>
                </MenubarSubContent>
              </MenubarSub>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Status</MenubarTrigger>
            <MenubarContent>
              <MenubarRadioGroup value="repairing">
                <MenubarRadioItem value="repairing">Repairing</MenubarRadioItem>
                <MenubarRadioItem value="ready">Ready</MenubarRadioItem>
              </MenubarRadioGroup>
              <MenubarSeparator />
              <MenubarItem disabled>Archive ticket</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </Row>
    </div>
  );
}
