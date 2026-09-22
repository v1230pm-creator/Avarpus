import { Button } from '../../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../../components/ui/alert-dialog';
import { Row, Stack } from '../parts';

export function AlertDialogDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Trigger">
        <Row>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete repair ticket</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete ticket RP-1042?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes Anita Sharma’s iPhone 13 repair record and cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep ticket</AlertDialogCancel>
                <AlertDialogAction>Delete ticket</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Row>
        <p className="text-sm text-muted-foreground">
          Opens as a modal; Escape or Cancel closes it.
        </p>
      </Stack>
      <Stack label="Confirmation anatomy">
        <div className="max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-sm">
          <div>
            <h3 className="font-semibold">Mark repair as delivered?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              RP-1041 has a ₹850 balance. Confirm payment before completing delivery.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline">Cancel</Button>
            <Button>Confirm delivery</Button>
          </div>
        </div>
      </Stack>
    </div>
  );
}
