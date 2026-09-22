import { Button } from '../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { Row } from '../parts';
export function TooltipDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <TooltipProvider>
        <Row label="Placement and state">
          <Tooltip defaultOpen>
            <TooltipTrigger asChild>
              <Button variant="outline">Balance due</Button>
            </TooltipTrigger>
            <TooltipContent side="top">₹2,400 remains unpaid</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">RP-1042</Button>
            </TooltipTrigger>
            <TooltipContent side="right">Open repair ticket</TooltipContent>
          </Tooltip>
        </Row>
      </TooltipProvider>
    </div>
  );
}
