import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Guidelines, Stack } from '../parts';

const REPAIRS = [
  {
    id: 'RP-1042',
    device: 'iPhone 13',
    customer: 'Anita Sharma',
    status: 'Repairing',
    due: '₹2,400',
  },
  { id: 'RP-1041', device: 'Redmi Note 12', customer: 'Farhan Ali', status: 'Ready', due: '₹850' },
  {
    id: 'RP-1039',
    device: 'Galaxy A54',
    customer: 'Prakash Rao',
    status: 'Waiting parts',
    due: '₹0',
  },
  { id: 'RP-1037', device: 'Vivo Y27', customer: 'Meena Iyer', status: 'Delivered', due: '₹0' },
];

export function TableDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repairs list">
        <Table>
          <TableCaption>Open repairs for Avarpus Mobile Care, Pune.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[110px]">Ticket</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Balance due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {REPAIRS.map((repair, index) => (
              <TableRow key={repair.id} data-state={index === 1 ? 'selected' : undefined}>
                <TableCell className="font-medium">{repair.id}</TableCell>
                <TableCell>{repair.device}</TableCell>
                <TableCell>{repair.customer}</TableCell>
                <TableCell>{repair.status}</TableCell>
                <TableCell className="text-right tabular-nums">{repair.due}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>Total outstanding</TableCell>
              <TableCell className="text-right tabular-nums">₹3,250</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Stack>

      <Stack label="Empty state">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
                No repairs match this filter.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Stack>

      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Right-align money columns and use tabular figures so amounts line up.',
            },
            {
              kind: 'do',
              text: 'Mark the active row with data-state="selected"; hover uses the muted surface, selection uses the full muted fill.',
            },
            {
              kind: 'dont',
              text: 'Do not colour whole rows by repair status — status belongs in its own cell (a badge once that family ships).',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
