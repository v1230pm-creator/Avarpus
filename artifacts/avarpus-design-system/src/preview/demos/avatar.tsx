import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Row } from '../parts';
export function AvatarDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Customers and staff">
        <Avatar>
          <AvatarImage src="/missing-anita-avatar.jpg" alt="Anita Sharma" />
          <AvatarFallback>AS</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>FA</AvatarFallback>
        </Avatar>
        <Avatar className="h-12 w-12">
          <AvatarFallback>RP</AvatarFallback>
        </Avatar>
      </Row>
    </div>
  );
}
