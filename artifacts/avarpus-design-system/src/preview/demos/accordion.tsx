import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../components/ui/accordion';
import { Stack } from '../parts';
export function AccordionDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Single">
        <Accordion type="single" collapsible defaultValue="diagnosis">
          <AccordionItem value="diagnosis">
            <AccordionTrigger>Diagnosis</AccordionTrigger>
            <AccordionContent>The iPhone 13 display assembly needs replacement.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="parts">
            <AccordionTrigger>Parts and pricing</AccordionTrigger>
            <AccordionContent>Display assembly ₹2,100 · Labour ₹300.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="notes" disabled>
            <AccordionTrigger>Internal notes</AccordionTrigger>
            <AccordionContent>No notes available.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Stack>
      <Stack label="Multiple">
        <Accordion type="multiple" defaultValue={['customer', 'device']}>
          <AccordionItem value="customer">
            <AccordionTrigger>Customer</AccordionTrigger>
            <AccordionContent>Anita Sharma · Pune</AccordionContent>
          </AccordionItem>
          <AccordionItem value="device">
            <AccordionTrigger>Device</AccordionTrigger>
            <AccordionContent>iPhone 13 · Midnight · 128 GB</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Stack>
    </div>
  );
}
