import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '../../components/ui/toast';
import { Stack } from '../parts';
export function ToastDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Default">
        <ToastProvider>
          <Toast open className="relative">
            <div className="grid gap-1">
              <ToastTitle>Repair saved</ToastTitle>
              <ToastDescription>RP-1042 was updated successfully.</ToastDescription>
            </div>
            <ToastAction altText="Open ticket">View</ToastAction>
            <ToastClose />
          </Toast>
        </ToastProvider>
      </Stack>
      <Stack label="Destructive">
        <ToastProvider>
          <Toast open variant="destructive" className="relative">
            <div className="grid gap-1">
              <ToastTitle>Could not save repair</ToastTitle>
              <ToastDescription>Check the connection and try again.</ToastDescription>
            </div>
            <ToastAction altText="Retry saving">Retry</ToastAction>
            <ToastClose />
          </Toast>
          <ToastViewport />
        </ToastProvider>
      </Stack>
    </div>
  );
}
