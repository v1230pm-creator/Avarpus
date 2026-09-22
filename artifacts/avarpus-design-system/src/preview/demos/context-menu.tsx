import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../../components/ui/context-menu';
import { Stack } from '../parts';
export function ContextMenuDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair ticket actions">
        <ContextMenu>
          <ContextMenuTrigger className="flex h-36 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            Right-click ticket RP-1042
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>Ticket actions</ContextMenuLabel>
            <ContextMenuItem>
              Open repair<ContextMenuShortcut>⌘O</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem inset>Edit customer</ContextMenuItem>
            <ContextMenuCheckboxItem checked>Priority repair</ContextMenuCheckboxItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Assign technician</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem>Arjun Mehta</ContextMenuItem>
                <ContextMenuItem>Neha Kapoor</ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup value="repairing">
              <ContextMenuRadioItem value="repairing">Repairing</ContextMenuRadioItem>
              <ContextMenuRadioItem value="ready">Ready</ContextMenuRadioItem>
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuItem disabled>Issue refund</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Stack>
    </div>
  );
}
