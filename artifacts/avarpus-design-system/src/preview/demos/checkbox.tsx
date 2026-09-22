import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Row, Stack } from '../parts';
export function CheckboxDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="States">
        <Checkbox id="checked" defaultChecked />
        <Label htmlFor="checked">Customer approved estimate</Label>
        <Checkbox id="unchecked" />
        <Label htmlFor="unchecked">Parts ordered</Label>
        <Checkbox checked="indeterminate" aria-label="Some checks complete" />
        <Checkbox disabled aria-label="Unavailable check" />
      </Row>
      <Stack label="Repair checklist">
        <Row>
          <label className="flex items-center gap-3">
            <Checkbox defaultChecked />
            Device photos captured
          </label>
          <label className="flex items-center gap-3">
            <Checkbox />
            SIM card returned
          </label>
        </Row>
      </Stack>
    </div>
  );
}
