import { Button } from '../../components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../../components/ui/sheet';
import { Row, Stack } from '../parts';

export function SheetDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Sides">
        <Row>
          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <Sheet key={side}>
              <SheetTrigger asChild>
                <Button variant="outline">Open {side}</Button>
              </SheetTrigger>
              <SheetContent side={side}>
                <SheetHeader>
                  <SheetTitle>Repair details</SheetTitle>
                  <SheetDescription>RP-1042 · Anita Sharma · iPhone 13</SheetDescription>
                </SheetHeader>
                <div className="py-6 text-sm">
                  <p>Display replacement and diagnostics</p>
                  <p className="mt-2 text-muted-foreground">Balance due: ₹2,400</p>
                </div>
                <SheetFooter>
                  <SheetClose asChild>
                    <Button>Save update</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ))}
        </Row>
        <p className="text-sm text-muted-foreground">
          Opens as a modal; Escape or Cancel closes it.
        </p>
      </Stack>
      <Row label="States">
        <Button variant="outline" disabled>
          Unavailable
        </Button>
      </Row>
    </div>
  );
}
