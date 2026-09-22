import { Switch } from '../../components/ui/switch';
import { Label } from '../../components/ui/label';
import { Row } from '../parts';
export function SwitchDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="States">
        <Switch id="sms" defaultChecked />
        <Label htmlFor="sms">SMS updates</Label>
        <Switch id="email" />
        <Label htmlFor="email">Email updates</Label>
        <Switch id="locked" disabled />
        <Label htmlFor="locked">Automatic delivery</Label>
      </Row>
    </div>
  );
}
