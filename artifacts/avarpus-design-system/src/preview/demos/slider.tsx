import { Slider } from '../../components/ui/slider';
import { Stack } from '../parts';
export function SliderDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair progress">
        <Slider defaultValue={[65]} max={100} step={5} aria-label="Repair progress" />
        <p className="text-sm text-muted-foreground">65% complete</p>
      </Stack>
      <Stack label="Price range">
        <Slider
          defaultValue={[850, 2400]}
          min={0}
          max={5000}
          step={50}
          aria-label="Repair price range"
        />
        <p className="text-sm tabular-nums text-muted-foreground">₹850 – ₹2,400</p>
      </Stack>
      <Stack label="States">
        <Slider defaultValue={[30]} disabled aria-label="Disabled progress" />
      </Stack>
    </div>
  );
}
