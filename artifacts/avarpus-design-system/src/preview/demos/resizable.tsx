import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../../components/ui/resizable';
import { Stack } from '../parts';
export function ResizableDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Horizontal panels">
        <ResizablePanelGroup direction="horizontal" className="min-h-48 rounded-lg border">
          <ResizablePanel defaultSize={35}>
            <div className="p-4">
              <p className="font-medium">Repair queue</p>
              <p className="text-sm text-muted-foreground">RP-1042 · iPhone 13</p>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={65}>
            <div className="p-4">
              <p className="font-medium">Ticket details</p>
              <p className="text-sm text-muted-foreground">Screen replacement · ₹2,400</p>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Stack>
      <Stack label="Vertical panels">
        <ResizablePanelGroup direction="vertical" className="min-h-48 rounded-lg border">
          <ResizablePanel defaultSize={50}>
            <div className="p-4">Customer: Anita Sharma</div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={50}>
            <div className="p-4">Technician notes</div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </Stack>
    </div>
  );
}
