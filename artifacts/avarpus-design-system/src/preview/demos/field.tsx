import { Input } from '../../components/ui/input';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '../../components/ui/field';
import { Stack } from '../parts';
export function FieldDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Orientations">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ticket-device">Device model</FieldLabel>
            <Input id="ticket-device" defaultValue="iPhone 13" />
            <FieldDescription>Use the model printed in device settings.</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Notify on completion</FieldTitle>
              <FieldDescription>Send Anita Sharma a pickup message.</FieldDescription>
            </FieldContent>
            <Checkbox defaultChecked />
          </Field>
          <Field orientation="responsive" data-invalid="true">
            <FieldContent>
              <FieldLabel htmlFor="estimate">Estimate</FieldLabel>
              <FieldDescription>Approved repair total in rupees.</FieldDescription>
            </FieldContent>
            <Input id="estimate" defaultValue="₹" aria-invalid />
            <FieldError errors={[{ message: 'Enter an amount.' }]} />
          </Field>
        </FieldGroup>
      </Stack>
      <FieldSeparator>or</FieldSeparator>
      <FieldSet>
        <FieldLegend variant="legend">Repair approval</FieldLegend>
        <FieldLegend variant="label">Customer confirmation</FieldLegend>
      </FieldSet>
    </div>
  );
}
