import { Progress } from '../../components/ui/progress';
import { Stack } from '../parts';

export function ProgressDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair progress">
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span>RP-1042 · Display replacement</span>
            <span className="tabular-nums">65%</span>
          </div>
          <Progress value={65} />
        </div>
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span>RP-1041 · Quality check</span>
            <span>Complete</span>
          </div>
          <Progress value={100} />
        </div>
      </Stack>
      <Stack label="States">
        <Progress value={0} />
        <Progress value={35} />
        <Progress value={undefined} />
      </Stack>
    </div>
  );
}
