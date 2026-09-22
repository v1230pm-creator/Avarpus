import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '../../components/ui/popover';
import { Row, Stack } from '../parts';

export function PopoverDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Trigger">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">View customer</Button>
          </PopoverTrigger>
          <PopoverContent>
            <p className="font-medium">Anita Sharma</p>
            <p className="mt-1 text-sm text-muted-foreground">iPhone 13 · RP-1042</p>
            <p className="mt-3 text-sm tabular-nums">Balance ₹2,400</p>
          </PopoverContent>
        </Popover>
      </Row>
      <Stack label="Anchored form">
        <Popover defaultOpen>
          <PopoverAnchor asChild>
            <Input className="max-w-xs" defaultValue="RP-1042" aria-label="Ticket search" />
          </PopoverAnchor>
          <PopoverContent side="bottom" align="start">
            <p className="text-sm font-medium">Matching repair</p>
            <p className="text-sm text-muted-foreground">Anita Sharma · Repairing</p>
          </PopoverContent>
        </Popover>
      </Stack>
    </div>
  );
}
