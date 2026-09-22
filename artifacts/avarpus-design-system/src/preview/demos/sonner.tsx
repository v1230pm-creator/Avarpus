import { Button } from '../../components/ui/button';
import { Toaster } from '../../components/ui/sonner';
import { toast } from 'sonner';
import { Row, Stack } from '../parts';
export function SonnerDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Toast region">
        <p className="text-sm text-muted-foreground">
          Notifications appear in the page toast region.
        </p>
        <Toaster position="bottom-right" richColors />
      </Stack>
      <Row label="Types">
        <Button variant="outline" onClick={() => toast.success('Repair RP-1042 saved')}>
          Success
        </Button>
        <Button variant="outline" onClick={() => toast.info('Customer notified')}>
          Info
        </Button>
        <Button variant="outline" onClick={() => toast.warning('Part stock is low')}>
          Warning
        </Button>
        <Button variant="outline" onClick={() => toast.error('Payment could not be recorded')}>
          Error
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast('Ticket assigned', {
              description: 'Arjun Mehta will handle this repair.',
              action: { label: 'Undo', onClick: () => {} },
            })
          }
        >
          With action
        </Button>
      </Row>
    </div>
  );
}
