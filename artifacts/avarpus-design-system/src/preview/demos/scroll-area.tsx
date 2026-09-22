import { ScrollArea, ScrollBar } from '../../components/ui/scroll-area';
import { Stack } from '../parts';
const REPAIRS = [
  'RP-1042 · iPhone 13 · Anita Sharma',
  'RP-1041 · Redmi Note 12 · Farhan Ali',
  'RP-1039 · Galaxy A54 · Prakash Rao',
  'RP-1037 · Vivo Y27 · Meena Iyer',
  'RP-1035 · OnePlus 11R · Kavya Nair',
  'RP-1032 · Pixel 7a · Rahul Sen',
];
export function ScrollAreaDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Vertical">
        <ScrollArea className="h-48 max-w-lg rounded-lg border">
          <div className="p-4">
            {REPAIRS.map((repair) => (
              <div key={repair} className="border-b py-3 text-sm last:border-0">
                {repair}
              </div>
            ))}
          </div>
        </ScrollArea>
      </Stack>
      <Stack label="Horizontal">
        <ScrollArea className="w-full whitespace-nowrap rounded-lg border">
          <div className="flex w-max gap-3 p-4">
            {REPAIRS.slice(0, 4).map((repair) => (
              <div key={repair} className="w-64 rounded-md bg-muted p-4 text-sm">
                {repair}
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Stack>
    </div>
  );
}
