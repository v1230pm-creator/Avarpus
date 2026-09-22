import { Separator } from '../../components/ui/separator';
import { Row, Stack } from '../parts';

export function SeparatorDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Horizontal">
        <div>
          <p className="font-medium">RP-1042 · iPhone 13</p>
          <p className="text-sm text-muted-foreground">Anita Sharma</p>
        </div>
        <Separator />
        <div className="flex justify-between text-sm">
          <span>Balance due</span>
          <span className="tabular-nums">₹2,400</span>
        </div>
      </Stack>
      <Row label="Vertical">
        <span>Diagnostics</span>
        <Separator orientation="vertical" className="h-5" />
        <span>Display replacement</span>
        <Separator orientation="vertical" className="h-5" />
        <span>Quality check</span>
      </Row>
    </div>
  );
}
