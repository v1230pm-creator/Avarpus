import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Label } from '../../components/ui/label';
import { Row } from '../parts';
export function RadioGroupDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Customer contact method">
        <RadioGroup defaultValue="whatsapp">
          <div className="flex items-center gap-2">
            <RadioGroupItem value="whatsapp" id="whatsapp" />
            <Label htmlFor="whatsapp">WhatsApp</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="sms" id="sms-radio" />
            <Label htmlFor="sms-radio">SMS</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="email" id="email-radio" disabled />
            <Label htmlFor="email-radio">Email unavailable</Label>
          </div>
        </RadioGroup>
      </Row>
    </div>
  );
}
