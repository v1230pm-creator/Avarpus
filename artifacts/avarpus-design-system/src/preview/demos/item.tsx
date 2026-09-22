import { Smartphone, Wrench } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '../../components/ui/item';
import { Stack } from '../parts';
function Repair({
  variant = 'default',
  size = 'default',
}: {
  variant?: 'default' | 'outline' | 'muted';
  size?: 'default' | 'sm';
}) {
  return (
    <Item variant={variant} size={size}>
      <ItemMedia variant="icon">
        <Smartphone />
      </ItemMedia>
      <ItemContent>
        <ItemHeader>
          <ItemTitle>RP-1042 · iPhone 13</ItemTitle>
        </ItemHeader>
        <ItemDescription>Anita Sharma · Screen replacement</ItemDescription>
        <ItemFooter>Balance due: ₹2,400</ItemFooter>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline">
          Open
        </Button>
      </ItemActions>
    </Item>
  );
}
export function ItemDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Variants">
        <ItemGroup>
          <Repair />
          <ItemSeparator />
          <Repair variant="outline" />
          <Repair variant="muted" size="sm" />
        </ItemGroup>
      </Stack>
      <Stack label="Media">
        <Item variant="outline">
          <ItemMedia>
            <Wrench />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Bench assignment</ItemTitle>
            <ItemDescription>Technician: Arjun Mehta</ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemMedia variant="image">
            <img
              alt="Phone awaiting repair"
              src="https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=80&q=80"
            />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Galaxy A54</ItemTitle>
            <ItemDescription>Waiting for replacement part</ItemDescription>
          </ItemContent>
        </Item>
      </Stack>
    </div>
  );
}
