import { Button } from '../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { Guidelines, Stack } from './parts';

const logoUrl = `${import.meta.env.BASE_URL}avarpus-logo.png`;

const CORE_SWATCHES = [
  { name: 'Primary', note: '#0F62FE · action blue', className: 'bg-primary' },
  { name: 'Secondary', note: '#EAF0F7 · quiet surface', className: 'border bg-secondary' },
  { name: 'Accent', note: '#EAF2FF · soft blue tint', className: 'border bg-accent' },
] as const;

const SUPPORTING_SWATCHES = [
  { name: 'Background', note: 'Canvas #F4F7FB / #1B212B', className: 'border bg-background' },
  { name: 'Card', note: 'Surface #FFFFFF / #262E3A', className: 'border bg-card' },
  { name: 'Foreground', note: 'Ink #162236 / #F1F4F8', className: 'bg-foreground' },
  { name: 'Muted', note: 'Muted fill', className: 'border bg-muted' },
  { name: 'Destructive', note: '#FF4D4F · danger', className: 'bg-destructive' },
  { name: 'Border', note: '#D7E1ED / #38424F', className: 'bg-border' },
] as const;

const CHART_SWATCHES = [
  { name: 'Chart 1', note: 'Brand blue', className: 'bg-chart-1' },
  { name: 'Chart 2', note: 'Success green', className: 'bg-chart-2' },
  { name: 'Chart 3', note: 'Brand gold', className: 'bg-chart-3' },
  { name: 'Chart 4', note: 'Purple', className: 'bg-chart-4' },
  { name: 'Chart 5', note: 'Cyan', className: 'bg-chart-5' },
] as const;

const TYPE_SCALE = [
  { label: 'Display', className: 'text-4xl font-bold', note: '36 / 700' },
  { label: 'Heading', className: 'text-2xl font-semibold', note: '24 / 600' },
  { label: 'Title', className: 'text-lg font-semibold', note: '18 / 600 · card titles' },
  { label: 'Body', className: 'text-base', note: '16 / 400' },
  { label: 'Label', className: 'text-sm font-medium', note: '14 / 500 · buttons, table heads' },
  { label: 'Caption', className: 'text-sm text-muted-foreground', note: '14 / 400 · muted' },
] as const;

const SPACING_SCALE = [
  { label: '4', className: 'w-1' },
  { label: '8', className: 'w-2' },
  { label: '12', className: 'w-3' },
  { label: '16', className: 'w-4' },
  { label: '24', className: 'w-6' },
  { label: '32', className: 'w-8' },
] as const;

function Swatch({
  name,
  note,
  className,
}: {
  name: string;
  note?: string;
  className: string;
}) {
  return (
    <div className="space-y-2">
      <div className={`h-16 rounded-lg ${className}`} />
      <p className="text-sm font-medium">{name}</p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function OverviewPage() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Core palette
        </h2>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {CORE_SWATCHES.map((swatch) => (
            <Swatch key={swatch.name} {...swatch} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 text-card-foreground">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Typography — Inter
          </h2>
          <div className="mt-4 space-y-3">
            {TYPE_SCALE.map((entry) => (
              <p key={entry.label} className={entry.className}>
                {entry.label}
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-card p-5 text-card-foreground">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            In use
          </h2>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>New repair intake</CardTitle>
              <CardDescription>
                Button, Input and Card composed from the tokens above.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Customer name" />
              <Input type="tel" inputMode="numeric" placeholder="Mobile number" />
            </CardContent>
            <CardFooter className="gap-2">
              <Button>Create ticket</Button>
              <Button variant="outline">Cancel</Button>
            </CardFooter>
          </Card>
        </section>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Components
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Spinner size={24} />
        </div>
        <p className="text-sm text-muted-foreground">
          All 53 families of the Avarpus web component library are ported verbatim and
          themed by the tokens above — from the five the product uses most (Button,
          Spinner, Input, Table, Card) to the full shadcn set of forms, overlays, menus,
          data display, feedback and chart primitives.
        </p>
      </section>
    </div>
  );
}

export function LogoPage() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Primary mark">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex h-48 items-center justify-center rounded-lg border bg-background">
            <img src={logoUrl} alt="Avarpus logo" width={112} height={112} className="h-28 w-28" />
          </div>
          <div className="flex h-48 items-center justify-center rounded-lg" style={{ background: '#006DA8' }}>
            <img src={logoUrl} alt="Avarpus logo on brand blue" width={112} height={112} className="h-28 w-28" />
          </div>
        </div>
      </Stack>

      <Stack label="Sizes">
        <div className="flex flex-wrap items-end gap-6">
          {[24, 36, 48, 64, 96].map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <img src={logoUrl} alt="" width={size} height={size} style={{ width: size, height: size }} />
              <span className="text-xs text-muted-foreground">{size}px</span>
            </div>
          ))}
        </div>
      </Stack>

      <Stack label="Brand surfaces (sign-in and splash)">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { name: 'Brand blue', hex: '#006DA8', fg: '#FFFFFF' },
            { name: 'Ink', hex: '#02405F', fg: '#FFFFFF' },
            { name: 'Splash sky', hex: '#0FA9FF', fg: '#02405F' },
          ].map((tone) => (
            <div
              key={tone.hex}
              className="flex h-24 flex-col justify-end rounded-lg p-3"
              style={{ background: tone.hex, color: tone.fg }}
            >
              <span className="text-sm font-medium">{tone.name}</span>
              <span className="text-xs opacity-80">{tone.hex}</span>
            </div>
          ))}
        </div>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            { kind: 'do', text: 'Use the circular mark as the app icon, header mark and favicon; keep clear space of at least a quarter of its width.' },
            { kind: 'do', text: 'On sign-in and splash, place the mark on flat brand blue (#006DA8) with a white pill call-to-action — no gradients on that path.' },
            { kind: 'dont', text: 'Do not recolour, outline or crop the mark, and never squeeze full-bleed splash art into the centred system icon.' },
          ]}
        />
      </Stack>
    </div>
  );
}

export function ColorsPage() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Brand colors</h2>
          <p className="text-sm text-muted-foreground">
            Extracted from the Avarpus phone app theme. Primary is the same action blue in
            light and dark mode.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {CORE_SWATCHES.map((swatch) => (
            <Swatch key={swatch.name} {...swatch} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Semantic and surface colors</h2>
          <p className="text-sm text-muted-foreground">
            Roles for the canvas, cards, text, borders, muted content and danger. Toggle
            dark mode in the sidebar to see the slate palette (never pure black).
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {SUPPORTING_SWATCHES.map((swatch) => (
            <Swatch key={swatch.name} {...swatch} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Status and chart colors</h2>
          <p className="text-sm text-muted-foreground">
            The repair-status hues from the phone app, reused for charts.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          {CHART_SWATCHES.map((swatch) => (
            <Swatch key={swatch.name} {...swatch} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function FontsPage() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <section>
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Font family — Inter
        </h2>
        <p className="mt-4 text-4xl font-bold">Repairs, customers, payments</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Inter in four weights (400, 500, 600, 700) on both the phone app and the web.
          Numbers use tabular figures wherever money or counts line up.
        </p>
      </section>

      <section className="space-y-4 border-t pt-6">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Type scale
        </h2>
        {TYPE_SCALE.map((entry) => (
          <div key={entry.label} className="grid gap-2 sm:grid-cols-[120px_1fr]">
            <span className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {entry.label}
              <br />
              <span className="normal-case tracking-normal">{entry.note}</span>
            </span>
            <p className={entry.className}>Ticket RP-1042 is ready for delivery.</p>
          </div>
        ))}
      </section>
    </div>
  );
}

export function LayoutPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-6 text-card-foreground">
        <h2 className="font-semibold">Spacing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A 4px step. Phone controls use 8/13/17 vertical and 14/20/26 horizontal padding;
          cards use 16.
        </p>
        <div className="mt-6 space-y-4">
          {SPACING_SCALE.map((space) => (
            <div key={space.label} className="flex items-center gap-4">
              <span className="w-8 text-xs text-muted-foreground">{space.label}</span>
              <div className={`h-3 rounded-full bg-primary ${space.className}`} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card p-6 text-card-foreground">
        <h2 className="font-semibold">Radius</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Base radius 12px (the phone app default); small 8, large 16, extra large 24.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-4">
          {[
            { label: 'Small', className: 'rounded-sm' },
            { label: 'Medium', className: 'rounded-md' },
            { label: 'Large', className: 'rounded-lg' },
            { label: 'Extra large', className: 'rounded-xl' },
          ].map((radius) => (
            <div
              key={radius.label}
              className={`flex h-24 items-end border bg-muted p-3 ${radius.className}`}
            >
              <span className="text-xs font-medium">{radius.label}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
