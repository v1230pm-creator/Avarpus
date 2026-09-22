import { FullPageLoader, SectionLoader, Spinner } from '../../components/ui/spinner';
import { Guidelines, Row, Stack } from '../parts';

export function SpinnerDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Sizes">
        <Spinner size={16} />
        <Spinner size={24} />
        <Spinner size={32} />
        <Spinner size={44} />
      </Row>

      <Row label="Colour follows the text colour">
        <span className="text-primary">
          <Spinner size={24} />
        </span>
        <span className="text-muted-foreground">
          <Spinner size={24} />
        </span>
        <span className="text-destructive">
          <Spinner size={24} />
        </span>
        <span className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-primary-foreground">
          <Spinner size={16} label={null} className="text-primary-foreground" />
          <span className="text-sm font-medium">Sending OTP…</span>
        </span>
      </Row>

      <Stack label="Section loader (fills a panel, table or dialog)">
        <div className="rounded-lg border bg-background">
          <SectionLoader message="Loading repairs…" />
        </div>
      </Stack>

      <Stack label="Full-page loader (framed here; fills the viewport in an app)">
        <div className="overflow-hidden rounded-lg border">
          <FullPageLoader className="h-56" message="Preparing your workspace" />
        </div>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Use this twelve-blade ring as the only loading motion in the product — 900 ms per turn, brightest blade leading.',
            },
            {
              kind: 'do',
              text: 'Pass label={null} when the surrounding control already names the action, so screen readers do not hear it twice.',
            },
            {
              kind: 'dont',
              text: 'Do not invent border spinners, skeleton pulses or progress arcs for waits the ring already covers.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
