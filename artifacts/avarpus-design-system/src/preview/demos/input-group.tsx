import { Search, X } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from '../../components/ui/input-group';
import { Kbd } from '../../components/ui/kbd';
import { Stack } from '../parts';
export function InputGroupDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Inline add-ons">
        <InputGroup>
          <InputGroupAddon align="inline-start">
            <Search />
            <InputGroupText>Ticket</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput placeholder="Search RP-1042" />
          <InputGroupAddon align="inline-end">
            <Kbd>⌘ K</Kbd>
            <InputGroupButton size="icon-xs" aria-label="Clear">
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Stack>
      <Stack label="Block add-ons">
        <InputGroup>
          <InputGroupAddon align="block-start">
            <InputGroupText>Technician notes</InputGroupText>
          </InputGroupAddon>
          <InputGroupTextarea placeholder="Describe the repair…" />
          <InputGroupAddon align="block-end">
            <InputGroupButton size="xs">Attach photo</InputGroupButton>
            <InputGroupButton size="sm" variant="default">
              Save note
            </InputGroupButton>
            <InputGroupButton size="icon-sm" aria-label="Clear">
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </Stack>
      <Stack label="State">
        <InputGroup data-disabled="true">
          <InputGroupInput disabled value="Repair completed" />
          <InputGroupAddon align="inline-end">
            <InputGroupText>Locked</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
      </Stack>
    </div>
  );
}
