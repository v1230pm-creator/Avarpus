import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Guidelines, Stack } from '../parts';

export function InputDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Default">
        <Input placeholder="Customer name" className="max-w-sm" />
      </Stack>

      <Stack label="Types">
        <Input type="tel" inputMode="numeric" placeholder="Mobile number" className="max-w-sm" />
        <Input type="email" placeholder="you@example.com" className="max-w-sm" />
        <Input type="number" placeholder="Advance amount (₹)" className="max-w-sm" />
        <Input type="search" placeholder="Search repairs, IMEI, phone…" className="max-w-sm" />
        <Input type="file" className="max-w-sm" />
      </Stack>

      <Stack label="With value and label">
        <label className="max-w-sm space-y-2 text-sm font-medium">
          <span>Device model</span>
          <Input defaultValue="Samsung Galaxy A54" />
        </label>
      </Stack>

      <Stack label="Invalid">
        <Input
          aria-invalid="true"
          defaultValue="98765"
          className="max-w-sm border-destructive focus-visible:ring-destructive"
        />
        <p className="text-sm text-destructive">Enter a 10-digit mobile number.</p>
      </Stack>

      <Stack label="Disabled">
        <Input disabled placeholder="Locked after delivery" className="max-w-sm" />
      </Stack>

      <Stack label="Composed with a button">
        <form className="flex max-w-sm gap-2" onSubmit={(event) => event.preventDefault()}>
          <Input type="tel" inputMode="numeric" placeholder="Mobile number" />
          <Button type="submit">Send OTP</Button>
        </form>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Use inputMode="numeric" for mobile numbers, OTP codes and money so phones open the right keyboard.',
            },
            {
              kind: 'do',
              text: 'Show validation copy in the destructive colour directly under the field it belongs to.',
            },
            {
              kind: 'dont',
              text: 'Do not restyle the focus ring per screen; the primary ring is the one focus treatment.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
