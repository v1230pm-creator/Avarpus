import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Row } from '../parts';

function RepairActionsMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={defaultOpen ? false : undefined}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Actions for RP-1042</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel>Ticket actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Open customer<DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem inset>Edit repair</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Notify customer</DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Set status</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value="repairing">
              <DropdownMenuRadioItem value="waiting">Waiting parts</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="repairing">Repairing</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="ready">Ready</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Issue refund</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive">Delete ticket</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DropdownMenuDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Repair actions">
        <RepairActionsMenu />
      </Row>
      <Row label="Open state">
        <RepairActionsMenu defaultOpen />
      </Row>
    </div>
  );
}
