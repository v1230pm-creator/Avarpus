import { PackageSearch, Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../components/ui/empty';
import { Stack } from '../parts';
export function EmptyDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Icon media">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackageSearch />
            </EmptyMedia>
            <EmptyTitle>No repairs found</EmptyTitle>
            <EmptyDescription>
              No tickets match the current customer or device filter.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button>
              <Plus />
              New intake
            </Button>
          </EmptyContent>
        </Empty>
      </Stack>
      <Stack label="Default media">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia>
              <span className="text-sm font-semibold">RP</span>
            </EmptyMedia>
            <EmptyTitle>Queue is clear</EmptyTitle>
            <EmptyDescription>New repair tickets will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Stack>
    </div>
  );
}
