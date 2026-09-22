import { Button } from '../../components/ui/button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from '../../components/ui/button-group';
import { Row } from '../parts';
export function ButtonGroupDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Horizontal">
        <ButtonGroup>
          <Button variant="outline">Previous</Button>
          <Button variant="outline">Today</Button>
          <Button variant="outline">Next</Button>
        </ButtonGroup>
        <ButtonGroup>
          <ButtonGroupText>₹</ButtonGroupText>
          <Button variant="outline">2,400</Button>
          <ButtonGroupSeparator />
          <Button>Collect</Button>
        </ButtonGroup>
      </Row>
      <Row label="Vertical">
        <ButtonGroup orientation="vertical">
          <Button variant="outline">Repairing</Button>
          <Button variant="outline">Ready</Button>
          <Button variant="outline">Delivered</Button>
        </ButtonGroup>
      </Row>
    </div>
  );
}
