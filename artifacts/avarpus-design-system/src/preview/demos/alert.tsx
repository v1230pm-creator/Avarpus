import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Stack } from '../parts';
function InfoIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
export function AlertDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Variants">
        <Alert>
          <InfoIcon />
          <AlertTitle>Parts arriving tomorrow</AlertTitle>
          <AlertDescription>The replacement display for RP-1042 is in transit.</AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <InfoIcon />
          <AlertTitle>Payment failed</AlertTitle>
          <AlertDescription>
            ₹2,400 could not be collected. Ask the customer to try another method.
          </AlertDescription>
        </Alert>
      </Stack>
    </div>
  );
}
