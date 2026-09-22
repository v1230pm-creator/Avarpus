import { Textarea } from '../../components/ui/textarea';
import { Stack } from '../parts';
export function TextareaDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair notes">
        <Textarea placeholder="Describe the reported issue…" />
        <Textarea defaultValue="Display flickers after the device warms up. Customer approved a ₹2,400 estimate." />
      </Stack>
      <Stack label="States">
        <Textarea disabled defaultValue="Notes locked after delivery." />
        <Textarea
          aria-invalid
          defaultValue="Battery condition is required."
          className="border-destructive"
        />
      </Stack>
    </div>
  );
}
