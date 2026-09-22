import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog';
import { Row, Stack } from '../parts';
export function DialogDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair confirmation">
        <Row>
          <Dialog>
            <DialogTrigger asChild>
              <Button>Mark repair ready</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Mark RP-1042 as ready?</DialogTitle>
                <DialogDescription>
                  Anita Sharma will be notified that the iPhone 13 is ready for pickup.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button>Confirm ready</Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Row>
        <p className="text-sm text-muted-foreground">
          Opens as a modal; Escape or Cancel closes it.
        </p>
      </Stack>
    </div>
  );
}
