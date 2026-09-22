import { Badge } from '../../components/ui/badge';
import { Guidelines, Row, Stack } from '../parts';
export function BadgeDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Variants">
        <Badge>Repairing</Badge>
        <Badge variant="secondary">Queued</Badge>
        <Badge variant="destructive">Overdue</Badge>
        <Badge variant="outline">RP-1042</Badge>
        <Badge variant="success">Ready</Badge>
        <Badge variant="warning">Waiting parts</Badge>
      </Row>
      <Stack label="Usage">
        <Guidelines
          items={[
            {
              kind: 'do',
              text: 'Use success and warning badges for repair status; reserve destructive for a state that needs immediate attention.',
            },
            {
              kind: 'dont',
              text: 'Do not use badge colour as the only status cue — include a clear text label.',
            },
          ]}
        />
      </Stack>
    </div>
  );
}
