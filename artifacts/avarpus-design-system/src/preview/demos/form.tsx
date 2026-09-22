import { useForm } from 'react-hook-form';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../../components/ui/form';
import { Stack } from '../parts';
type Intake = { customer: string; device: string };
export function FormDemo() {
  const form = useForm<Intake>({ defaultValues: { customer: 'Anita Sharma', device: '' } });
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair intake">
        <Form {...form}>
          <form className="max-w-md space-y-4" onSubmit={form.handleSubmit(() => undefined)}>
            <FormField
              control={form.control}
              name="customer"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>Name shown on the repair ticket.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="device"
              rules={{ required: 'Enter the device model.' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Device</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. iPhone 13" {...field} />
                  </FormControl>
                  <FormMessage>Enter the device model.</FormMessage>
                </FormItem>
              )}
            />
            <Button type="submit">Create ticket</Button>
          </form>
        </Form>
      </Stack>
    </div>
  );
}
