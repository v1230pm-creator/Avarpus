import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Guidelines, Stack } from '../parts';

export function CardDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Default (header, content, footer)">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Repair RP-1042</CardTitle>
              <CardDescription>iPhone 13 · Screen replacement</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Customer: <span className="font-medium">Anita Sharma</span>
              </p>
              <p className="text-muted-foreground">Received 20 Sep · Promised 23 Sep</p>
            </CardContent>
            <CardFooter className="gap-2">
              <Button size="sm">Mark ready</Button>
              <Button size="sm" variant="outline">
                Add note
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record payment</CardTitle>
              <CardDescription>
                Payments are append-only; corrections go through a refund.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input type="number" inputMode="numeric" placeholder="Amount (₹)" />
              <Input placeholder="Reference (optional)" />
            </CardContent>
            <CardFooter>
              <Button className="w-full">Save payment</Button>
            </CardFooter>
          </Card>
        </div>
      </Stack>

      <Stack label="Stat cards (content only)">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Open repairs', value: '18' },
            { label: 'Ready to deliver', value: '5' },
            { label: 'Outstanding', value: '₹12,450' },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardContent className="p-5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Keep cards restrained — a white (or slate) surface, one hairline border and a soft shadow, so the product reads as secure and operational.',
            },
            {
              kind: 'do',
              text: 'On dark mode the canvas stays visibly darker than cards; surfaces separate on their own without extra borders.',
            },
            {
              kind: 'dont',
              text: 'Do not layer glass, gradients or wallpaper behind cards; list items that keep a flat, borderless look break the shared surface language.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
