import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../components/ui/hover-card';
import { Row } from '../parts';
export function HoverCardDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Customer preview">
        <HoverCard defaultOpen openDelay={0}>
          <HoverCardTrigger asChild>
            <button className="w-fit font-medium text-primary underline underline-offset-4">
              Anita Sharma
            </button>
          </HoverCardTrigger>
          <HoverCardContent>
            <p className="font-semibold">Anita Sharma</p>
            <p className="mt-1 text-sm text-muted-foreground">3 repairs · ₹2,400 outstanding</p>
            <p className="mt-3 text-xs">Current device: iPhone 13</p>
          </HoverCardContent>
        </HoverCard>
      </Row>
    </div>
  );
}
