import { Toaster } from '../../components/ui/toaster';
import { Button } from '../../components/ui/button';
import { Row, Stack } from '../parts';
export function ToasterDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Application viewport">
        <p className="text-sm text-muted-foreground">
          Mount one toaster viewport at the application root for repair updates and errors.
        </p>
        <Row>
          <Button disabled className="w-fit">
            Toast viewport mounted
          </Button>
        </Row>
        <Toaster />
      </Stack>
    </div>
  );
}
