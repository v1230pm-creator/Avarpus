import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { Guidelines, Row, Stack } from '../parts';

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ButtonDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Variants">
        <Button>Save repair</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="destructive">Delete</Button>
      </Row>

      <Row label="Sizes">
        <Button size="sm">Small</Button>
        <Button size="default">Default</Button>
        <Button size="lg">Large</Button>
        <Button size="icon" aria-label="Add">
          <PlusIcon />
        </Button>
      </Row>

      <Row label="With icon">
        <Button>
          <PlusIcon />
          <span className="ml-2">New intake</span>
        </Button>
        <Button variant="outline">
          <PlusIcon />
          <span className="ml-2">Add part</span>
        </Button>
      </Row>

      <Row label="States">
        <Button disabled>Disabled</Button>
        <Button disabled>
          <Spinner size={16} label={null} className="mr-2 text-primary-foreground" />
          Saving…
        </Button>
        <Button variant="outline" disabled>
          Disabled outline
        </Button>
      </Row>

      <Row label="As a link (asChild)">
        <Button asChild variant="link" className="w-fit px-0">
          <a href="#overview">Open the overview</a>
        </Button>
      </Row>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Use one primary button per view for the main action; secondary and outline carry the rest.',
            },
            {
              kind: 'do',
              text: 'While a request is in flight, keep the button disabled and show the Avarpus loading ring inside it.',
            },
            {
              kind: 'dont',
              text: 'Do not drive the loading ring from a durable status or from a plain disabled state — only a real in-flight request may spin.',
            },
            {
              kind: 'dont',
              text: 'Do not introduce new button colours; destructive is reserved for irreversible actions.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
