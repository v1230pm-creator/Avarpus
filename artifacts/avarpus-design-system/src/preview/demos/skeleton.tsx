import { Skeleton } from '../../components/ui/skeleton';
import { Row, Stack } from '../parts';

export function SkeletonDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Shapes">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-24" />
      </Row>
      <Stack label="Repair card loading">
        <div className="flex max-w-md gap-4 rounded-lg border p-4">
          <Skeleton className="size-12 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </Stack>
    </div>
  );
}
