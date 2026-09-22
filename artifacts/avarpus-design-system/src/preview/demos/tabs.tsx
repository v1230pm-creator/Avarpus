import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Stack } from '../parts';
export function TabsDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair workspace">
        <Tabs defaultValue="details" className="w-full">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="payments" disabled>
              Payments
            </TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="rounded-lg border p-4 text-sm">
            iPhone 13 · screen replacement · Anita Sharma
          </TabsContent>
          <TabsContent value="timeline" className="rounded-lg border p-4 text-sm">
            Checked in → Diagnosed → Repairing
          </TabsContent>
          <TabsContent value="payments">No payments recorded.</TabsContent>
        </Tabs>
      </Stack>
    </div>
  );
}
