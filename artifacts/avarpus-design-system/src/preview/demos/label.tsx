import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Checkbox } from '../../components/ui/checkbox';
import { Row, Stack } from '../parts';
export function LabelDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Input label">
        <Label htmlFor="customer-name">Customer name</Label>
        <Input id="customer-name" defaultValue="Anita Sharma" />
      </Stack>
      <Row label="Control label">
        <Checkbox id="notify-label" defaultChecked />
        <Label htmlFor="notify-label">Notify customer when ready</Label>
      </Row>
      <Row label="Disabled state">
        <Label className="peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
          IMEI number unavailable
        </Label>
      </Row>
    </div>
  );
}
