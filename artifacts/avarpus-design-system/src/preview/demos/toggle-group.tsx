import { AlignCenter, AlignLeft, AlignRight, List, Rows3 } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { Row } from '../parts';
export function ToggleGroupDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Single selection">
        <ToggleGroup type="single" defaultValue="list" aria-label="Repair view">
          <ToggleGroupItem value="list" aria-label="List view">
            <List />
          </ToggleGroupItem>
          <ToggleGroupItem value="compact" aria-label="Compact view">
            <Rows3 />
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row label="Outline and sizes">
        <ToggleGroup type="multiple" variant="outline" size="sm" defaultValue={['left']}>
          <ToggleGroupItem value="left" aria-label="Align left">
            <AlignLeft />
          </ToggleGroupItem>
          <ToggleGroupItem value="center" aria-label="Align center">
            <AlignCenter />
          </ToggleGroupItem>
          <ToggleGroupItem value="right" aria-label="Align right">
            <AlignRight />
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" size="lg" defaultValue="active">
          <ToggleGroupItem value="active">Active</ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </Row>
    </div>
  );
}
