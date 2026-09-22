import { Kbd, KbdGroup } from '../../components/ui/kbd';
import { Row, Stack } from '../parts';
export function KbdDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Keys">
        <Kbd>Esc</Kbd>
        <Kbd>Enter</Kbd>
        <Kbd>⌘</Kbd>
      </Row>
      <Stack label="Shortcut groups">
        <p className="flex items-center gap-3 text-sm">
          Search repairs{' '}
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <span>+</span>
            <Kbd>K</Kbd>
          </KbdGroup>
        </p>
        <p className="flex items-center gap-3 text-sm">
          New intake{' '}
          <KbdGroup>
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>N</Kbd>
          </KbdGroup>
        </p>
      </Stack>
    </div>
  );
}
