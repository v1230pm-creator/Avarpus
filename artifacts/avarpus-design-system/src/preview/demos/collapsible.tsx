import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible';
import { Stack } from '../parts';
export function CollapsibleDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair details">
        <Collapsible defaultOpen className="rounded-lg border p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between font-medium">
            Ticket RP-1042 <ChevronDown className="size-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm text-muted-foreground">
            iPhone 13 · Screen replacement · ₹2,400 due
          </CollapsibleContent>
        </Collapsible>
      </Stack>
      <Stack label="Collapsed">
        <Collapsible className="rounded-lg border p-4">
          <CollapsibleTrigger className="font-medium">Show technician notes</CollapsibleTrigger>
          <CollapsibleContent className="pt-3 text-sm">
            Display tested after repair.
          </CollapsibleContent>
        </Collapsible>
      </Stack>
    </div>
  );
}
