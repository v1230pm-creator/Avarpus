import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../../components/ui/chart';
import { Row, Stack } from '../parts';
const DATA = [
  { day: 'Mon', repairs: 8, revenue: 12400 },
  { day: 'Tue', repairs: 12, revenue: 18600 },
  { day: 'Wed', repairs: 9, revenue: 14200 },
  { day: 'Thu', repairs: 15, revenue: 24800 },
  { day: 'Fri', repairs: 11, revenue: 17900 },
  { day: 'Sat', repairs: 6, revenue: 9800 },
];
const CONFIG = {
  repairs: { label: 'Repairs', color: 'hsl(var(--chart-1))' },
  revenue: { label: 'Revenue', color: 'hsl(var(--chart-2))' },
};
export function ChartDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repairs completed">
        <ChartContainer config={CONFIG} className="min-h-64 w-full">
          <BarChart data={DATA}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="repairs" fill="var(--color-repairs)" radius={4} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Stack>
      <Row label="Revenue trend">
        <ChartContainer config={CONFIG} className="h-56 w-full max-w-2xl">
          <LineChart data={DATA}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Line
              dataKey="revenue"
              stroke="var(--color-revenue)"
              strokeWidth={2}
              dot
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </Row>
    </div>
  );
}
