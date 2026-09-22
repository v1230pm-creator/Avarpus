import * as React from 'react';
import { Calendar } from '../../components/ui/calendar';
import { Row, Stack } from '../parts';
const FIXED_DATE = new Date(2026, 8, 22, 12);
export function CalendarDemo() {
  const [selected, setSelected] = React.useState<Date | undefined>(FIXED_DATE);
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Single date">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={setSelected}
          defaultMonth={FIXED_DATE}
        />
        <Calendar
          mode="single"
          selected={FIXED_DATE}
          defaultMonth={FIXED_DATE}
          captionLayout="dropdown"
          startMonth={new Date(2024, 0, 1)}
          endMonth={new Date(2028, 11, 31)}
          disabled={[new Date(2026, 8, 20), new Date(2026, 8, 21)]}
        />
      </Row>
      <Stack label="Selected appointment">
        <p className="text-sm">Anita Sharma · Tuesday, 22 September 2026 · Screen repair pickup</p>
      </Stack>
    </div>
  );
}
