import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Row } from '../parts';
export function SelectDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Repair status">
        <Select defaultValue="repairing">
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Choose status" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Active</SelectLabel>
              <SelectItem value="diagnosis">Diagnosis</SelectItem>
              <SelectItem value="repairing">Repairing</SelectItem>
              <SelectItem value="parts">Waiting parts</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Completed</SelectLabel>
              <SelectItem value="ready">Ready</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select disabled>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Status unavailable" />
          </SelectTrigger>
        </Select>
      </Row>
    </div>
  );
}
