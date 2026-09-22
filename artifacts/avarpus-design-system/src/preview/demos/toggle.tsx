import { Bold, Italic, Underline } from 'lucide-react';
import { Toggle } from '../../components/ui/toggle';
import { Row } from '../parts';
export function ToggleDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Variants">
        <Toggle aria-label="Bold note">
          <Bold />
        </Toggle>
        <Toggle variant="outline" aria-label="Italic note">
          <Italic />
        </Toggle>
        <Toggle pressed aria-label="Underline note">
          <Underline />
        </Toggle>
        <Toggle disabled>Locked</Toggle>
      </Row>
      <Row label="Sizes">
        <Toggle size="sm">Small</Toggle>
        <Toggle size="default">Default</Toggle>
        <Toggle size="lg">Large</Toggle>
      </Row>
    </div>
  );
}
