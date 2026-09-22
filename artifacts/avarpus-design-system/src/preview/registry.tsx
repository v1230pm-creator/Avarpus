import { lazy, type ComponentType } from 'react';
import {
  ColorsPage,
  FontsPage,
  LayoutPage,
  LogoPage,
  OverviewPage,
} from './foundations';

function lazyPage(load: () => Promise<ComponentType>) {
  return lazy(async () => ({ default: await load() }));
}

const AccordionDemo = lazyPage(() =>
  import('./demos/accordion').then(({ AccordionDemo }) => AccordionDemo),
);
const AlertDemo = lazyPage(() =>
  import('./demos/alert').then(({ AlertDemo }) => AlertDemo),
);
const AlertDialogDemo = lazyPage(() =>
  import('./demos/alert-dialog').then(({ AlertDialogDemo }) => AlertDialogDemo),
);
const AspectRatioDemo = lazyPage(() =>
  import('./demos/aspect-ratio').then(({ AspectRatioDemo }) => AspectRatioDemo),
);
const AvatarDemo = lazyPage(() =>
  import('./demos/avatar').then(({ AvatarDemo }) => AvatarDemo),
);
const BadgeDemo = lazyPage(() =>
  import('./demos/badge').then(({ BadgeDemo }) => BadgeDemo),
);
const BreadcrumbDemo = lazyPage(() =>
  import('./demos/breadcrumb').then(({ BreadcrumbDemo }) => BreadcrumbDemo),
);
const ButtonDemo = lazyPage(() =>
  import('./demos/button').then(({ ButtonDemo }) => ButtonDemo),
);
const ButtonGroupDemo = lazyPage(() =>
  import('./demos/button-group').then(({ ButtonGroupDemo }) => ButtonGroupDemo),
);
const CalendarDemo = lazyPage(() =>
  import('./demos/calendar').then(({ CalendarDemo }) => CalendarDemo),
);
const CardDemo = lazyPage(() =>
  import('./demos/card').then(({ CardDemo }) => CardDemo),
);
const CarouselDemo = lazyPage(() =>
  import('./demos/carousel').then(({ CarouselDemo }) => CarouselDemo),
);
const ChartDemo = lazyPage(() =>
  import('./demos/chart').then(({ ChartDemo }) => ChartDemo),
);
const CheckboxDemo = lazyPage(() =>
  import('./demos/checkbox').then(({ CheckboxDemo }) => CheckboxDemo),
);
const CollapsibleDemo = lazyPage(() =>
  import('./demos/collapsible').then(({ CollapsibleDemo }) => CollapsibleDemo),
);
const ContextMenuDemo = lazyPage(() =>
  import('./demos/context-menu').then(({ ContextMenuDemo }) => ContextMenuDemo),
);
const DialogDemo = lazyPage(() =>
  import('./demos/dialog').then(({ DialogDemo }) => DialogDemo),
);
const DropdownMenuDemo = lazyPage(() =>
  import('./demos/dropdown-menu').then(({ DropdownMenuDemo }) => DropdownMenuDemo),
);
const EmptyDemo = lazyPage(() =>
  import('./demos/empty').then(({ EmptyDemo }) => EmptyDemo),
);
const FieldDemo = lazyPage(() =>
  import('./demos/field').then(({ FieldDemo }) => FieldDemo),
);
const FormDemo = lazyPage(() =>
  import('./demos/form').then(({ FormDemo }) => FormDemo),
);
const HoverCardDemo = lazyPage(() =>
  import('./demos/hover-card').then(({ HoverCardDemo }) => HoverCardDemo),
);
const InputDemo = lazyPage(() =>
  import('./demos/input').then(({ InputDemo }) => InputDemo),
);
const InputGroupDemo = lazyPage(() =>
  import('./demos/input-group').then(({ InputGroupDemo }) => InputGroupDemo),
);
const InputOtpDemo = lazyPage(() =>
  import('./demos/input-otp').then(({ InputOtpDemo }) => InputOtpDemo),
);
const ItemDemo = lazyPage(() =>
  import('./demos/item').then(({ ItemDemo }) => ItemDemo),
);
const KbdDemo = lazyPage(() =>
  import('./demos/kbd').then(({ KbdDemo }) => KbdDemo),
);
const LabelDemo = lazyPage(() =>
  import('./demos/label').then(({ LabelDemo }) => LabelDemo),
);
const MenubarDemo = lazyPage(() =>
  import('./demos/menubar').then(({ MenubarDemo }) => MenubarDemo),
);
const NavigationMenuDemo = lazyPage(() =>
  import('./demos/navigation-menu').then(({ NavigationMenuDemo }) => NavigationMenuDemo),
);
const PaginationDemo = lazyPage(() =>
  import('./demos/pagination').then(({ PaginationDemo }) => PaginationDemo),
);
const PopoverDemo = lazyPage(() =>
  import('./demos/popover').then(({ PopoverDemo }) => PopoverDemo),
);
const ProgressDemo = lazyPage(() =>
  import('./demos/progress').then(({ ProgressDemo }) => ProgressDemo),
);
const RadioGroupDemo = lazyPage(() =>
  import('./demos/radio-group').then(({ RadioGroupDemo }) => RadioGroupDemo),
);
const ResizableDemo = lazyPage(() =>
  import('./demos/resizable').then(({ ResizableDemo }) => ResizableDemo),
);
const ScrollAreaDemo = lazyPage(() =>
  import('./demos/scroll-area').then(({ ScrollAreaDemo }) => ScrollAreaDemo),
);
const SelectDemo = lazyPage(() =>
  import('./demos/select').then(({ SelectDemo }) => SelectDemo),
);
const SeparatorDemo = lazyPage(() =>
  import('./demos/separator').then(({ SeparatorDemo }) => SeparatorDemo),
);
const SheetDemo = lazyPage(() =>
  import('./demos/sheet').then(({ SheetDemo }) => SheetDemo),
);
const SidebarDemo = lazyPage(() =>
  import('./demos/sidebar').then(({ SidebarDemo }) => SidebarDemo),
);
const SkeletonDemo = lazyPage(() =>
  import('./demos/skeleton').then(({ SkeletonDemo }) => SkeletonDemo),
);
const SliderDemo = lazyPage(() =>
  import('./demos/slider').then(({ SliderDemo }) => SliderDemo),
);
const SonnerDemo = lazyPage(() =>
  import('./demos/sonner').then(({ SonnerDemo }) => SonnerDemo),
);
const SpinnerDemo = lazyPage(() =>
  import('./demos/spinner').then(({ SpinnerDemo }) => SpinnerDemo),
);
const SwitchDemo = lazyPage(() =>
  import('./demos/switch').then(({ SwitchDemo }) => SwitchDemo),
);
const TableDemo = lazyPage(() =>
  import('./demos/table').then(({ TableDemo }) => TableDemo),
);
const TabsDemo = lazyPage(() =>
  import('./demos/tabs').then(({ TabsDemo }) => TabsDemo),
);
const TextareaDemo = lazyPage(() =>
  import('./demos/textarea').then(({ TextareaDemo }) => TextareaDemo),
);
const ToastDemo = lazyPage(() =>
  import('./demos/toast').then(({ ToastDemo }) => ToastDemo),
);
const ToasterDemo = lazyPage(() =>
  import('./demos/toaster').then(({ ToasterDemo }) => ToasterDemo),
);
const ToggleDemo = lazyPage(() =>
  import('./demos/toggle').then(({ ToggleDemo }) => ToggleDemo),
);
const ToggleGroupDemo = lazyPage(() =>
  import('./demos/toggle-group').then(({ ToggleGroupDemo }) => ToggleGroupDemo),
);
const TooltipDemo = lazyPage(() =>
  import('./demos/tooltip').then(({ TooltipDemo }) => TooltipDemo),
);

export type PreviewEntry = {
  // Globally unique across every group — it is the deep-link slug (`#page=<id>`)
  // and the active-page key. Group-qualify names that repeat across groups
  // (e.g. `brand-icons` vs `components-icons`).
  id: string;
  name: string;
  description: string;
  Page: ComponentType;
};

export type NavGroup = {
  name: string;
  entries: PreviewEntry[];
};

export const DESIGN_SYSTEM = {
  title: 'Avarpus Design System',
  description:
    'The visual language of the Avarpus repair-shop platform, extracted from the phone app theme and the web app component library: a calm slate-and-blue palette, Inter, 12px corners and one loading ring.',
} as const;

export const OVERVIEW_ENTRY: PreviewEntry = {
  id: 'overview',
  name: 'Overview',
  description: 'Foundations, the component library, and how they compose.',
  Page: OverviewPage,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    name: 'Brand',
    entries: [
      {
        id: 'brand-logo',
        name: 'Logo',
        description: 'The Avarpus mark, sizes, brand surfaces and usage rules.',
        Page: LogoPage,
      },
    ],
  },
  {
    name: 'Colors',
    entries: [
      {
        id: 'color-roles',
        name: 'Color roles',
        description: 'Brand, semantic, surface, status and chart colors in light and dark mode.',
        Page: ColorsPage,
      },
    ],
  },
  {
    name: 'Fonts',
    entries: [
      {
        id: 'type-scale',
        name: 'Type scale',
        description: 'Inter weights, headings, body text, labels and captions.',
        Page: FontsPage,
      },
    ],
  },
  {
    name: 'Layout',
    entries: [
      {
        id: 'spacing-radius',
        name: 'Spacing and radius',
        description: 'The 4px rhythm and the 12px corner family.',
        Page: LayoutPage,
      },
    ],
  },
  {
    name: 'Actions',
    entries: [
      {
        id: 'button',
        name: 'Button',
        description: 'Six variants, four sizes, icon and loading treatments.',
        Page: ButtonDemo,
      },
      {
        id: 'button-group',
        name: 'Button group',
        description: 'Horizontal and vertical grouped repair actions.',
        Page: ButtonGroupDemo,
      },
      {
        id: 'toggle',
        name: 'Toggle',
        description: 'Default and outline toggles in every size and state.',
        Page: ToggleDemo,
      },
      {
        id: 'toggle-group',
        name: 'Toggle group',
        description: 'Single and multiple selection groups with variants and sizes.',
        Page: ToggleGroupDemo,
      },
    ],
  },
  {
    name: 'Forms & inputs',
    entries: [
      {
        id: 'input',
        name: 'Input',
        description: 'Text, phone, number, search and file fields with states.',
        Page: InputDemo,
      },
      {
        id: 'input-group',
        name: 'Input group',
        description: 'Inputs and textareas with inline and block add-ons.',
        Page: InputGroupDemo,
      },
      {
        id: 'input-otp',
        name: 'Input OTP',
        description: 'Grouped verification-code slots with separator and disabled state.',
        Page: InputOtpDemo,
      },
      {
        id: 'textarea',
        name: 'Textarea',
        description: 'Multiline repair notes with key states.',
        Page: TextareaDemo,
      },
      {
        id: 'label',
        name: 'Label',
        description: 'Accessible labels for inputs and controls.',
        Page: LabelDemo,
      },
      {
        id: 'field',
        name: 'Field',
        description: 'Structured fields in vertical, horizontal and responsive layouts.',
        Page: FieldDemo,
      },
      {
        id: 'form',
        name: 'Form',
        description: 'React Hook Form composition with validation messaging.',
        Page: FormDemo,
      },
      {
        id: 'checkbox',
        name: 'Checkbox',
        description: 'Repair checklist controls including the indeterminate state.',
        Page: CheckboxDemo,
      },
      {
        id: 'radio-group',
        name: 'Radio group',
        description: 'Single-choice customer contact method.',
        Page: RadioGroupDemo,
      },
      {
        id: 'switch',
        name: 'Switch',
        description: 'Binary notification preferences with disabled state.',
        Page: SwitchDemo,
      },
      {
        id: 'select',
        name: 'Select',
        description: 'Grouped repair-status selection.',
        Page: SelectDemo,
      },
      {
        id: 'slider',
        name: 'Slider',
        description: 'Repair progress, price range, multiple thumbs and disabled state.',
        Page: SliderDemo,
      },
      {
        id: 'calendar',
        name: 'Calendar',
        description: 'Fixed-date appointment selection with label and dropdown captions.',
        Page: CalendarDemo,
      },
    ],
  },
  {
    name: 'Overlays',
    entries: [
      {
        id: 'dialog',
        name: 'Dialog',
        description: 'Modal confirmation flow for repair actions.',
        Page: DialogDemo,
      },
      {
        id: 'alert-dialog',
        name: 'Alert dialog',
        description: 'Confirmation dialog for consequential repair actions.',
        Page: AlertDialogDemo,
      },
      {
        id: 'sheet',
        name: 'Sheet',
        description: 'Edge-mounted repair detail panels in all four directions.',
        Page: SheetDemo,
      },
      {
        id: 'popover',
        name: 'Popover',
        description: 'Compact anchored customer and ticket context.',
        Page: PopoverDemo,
      },
      {
        id: 'hover-card',
        name: 'Hover card',
        description: 'Hover preview for customer repair history and outstanding balance.',
        Page: HoverCardDemo,
      },
      {
        id: 'tooltip',
        name: 'Tooltip',
        description: 'Contextual details on hover or focus.',
        Page: TooltipDemo,
      },
    ],
  },
  {
    name: 'Menus & navigation',
    entries: [
      {
        id: 'dropdown-menu',
        name: 'Dropdown menu',
        description: 'Grouped ticket actions with checks, radio choices, shortcuts and submenus.',
        Page: DropdownMenuDemo,
      },
      {
        id: 'context-menu',
        name: 'Context menu',
        description: 'Right-click ticket actions with checks, radio choices, shortcuts and submenus.',
        Page: ContextMenuDemo,
      },
      {
        id: 'menubar',
        name: 'Menubar',
        description: 'Workshop commands with labels, shortcuts, checks, radio items and submenus.',
        Page: MenubarDemo,
      },
      {
        id: 'navigation-menu',
        name: 'Navigation menu',
        description: 'Workshop navigation with open-repair summary content.',
        Page: NavigationMenuDemo,
      },
      {
        id: 'tabs',
        name: 'Tabs',
        description: 'Switches among repair workspace views.',
        Page: TabsDemo,
      },
      {
        id: 'breadcrumb',
        name: 'Breadcrumb',
        description: 'Hierarchical repair and customer paths with collapsed navigation.',
        Page: BreadcrumbDemo,
      },
      {
        id: 'pagination',
        name: 'Pagination',
        description: 'Paged navigation for ticket result sets.',
        Page: PaginationDemo,
      },
      {
        id: 'sidebar',
        name: 'Sidebar',
        description: 'Full repair-dashboard shell covering sidebar composition and menu variants.',
        Page: SidebarDemo,
      },
    ],
  },
  {
    name: 'Data display',
    entries: [
      {
        id: 'card',
        name: 'Card',
        description: 'Grouped content with header, body and footer.',
        Page: CardDemo,
      },
      {
        id: 'table',
        name: 'Table',
        description: 'Repair lists, selected rows, footers and empty states.',
        Page: TableDemo,
      },
      {
        id: 'badge',
        name: 'Badge',
        description: 'Compact repair-status labels with six semantic variants.',
        Page: BadgeDemo,
      },
      {
        id: 'avatar',
        name: 'Avatar',
        description: 'Customer and staff identity images with fallbacks.',
        Page: AvatarDemo,
      },
      {
        id: 'item',
        name: 'Item',
        description: 'Repair list items covering every media variant and size.',
        Page: ItemDemo,
      },
      {
        id: 'accordion',
        name: 'Accordion',
        description: 'Single and multi-open disclosure sections for repair information.',
        Page: AccordionDemo,
      },
      {
        id: 'carousel',
        name: 'Carousel',
        description: 'Horizontal and vertical repair-card carousels.',
        Page: CarouselDemo,
      },
      {
        id: 'kbd',
        name: 'Keyboard key',
        description: 'Individual keys and grouped workshop shortcuts.',
        Page: KbdDemo,
      },
    ],
  },
  {
    name: 'Feedback',
    entries: [
      {
        id: 'spinner',
        name: 'Spinner',
        description: 'The twelve-blade Avarpus loading ring, section and full-page loaders.',
        Page: SpinnerDemo,
      },
      {
        id: 'skeleton',
        name: 'Skeleton',
        description: 'Loading placeholders for common shapes and repair cards.',
        Page: SkeletonDemo,
      },
      {
        id: 'progress',
        name: 'Progress',
        description: 'Determinate, complete, empty and indeterminate repair progress.',
        Page: ProgressDemo,
      },
      {
        id: 'alert',
        name: 'Alert',
        description: 'Default and destructive persistent messages.',
        Page: AlertDemo,
      },
      {
        id: 'empty',
        name: 'Empty state',
        description: 'Empty repair-queue states with a primary recovery action.',
        Page: EmptyDemo,
      },
      {
        id: 'toast',
        name: 'Toast',
        description: 'Default and destructive transient notifications with actions.',
        Page: ToastDemo,
      },
      {
        id: 'toaster',
        name: 'Toaster',
        description: 'Application-level provider and responsive toast viewport.',
        Page: ToasterDemo,
      },
      {
        id: 'sonner',
        name: 'Sonner',
        description: 'Theme-aware success, info, warning, error and actionable toasts.',
        Page: SonnerDemo,
      },
    ],
  },
  {
    name: 'Structure',
    entries: [
      {
        id: 'separator',
        name: 'Separator',
        description: 'Horizontal and vertical division for repair details.',
        Page: SeparatorDemo,
      },
      {
        id: 'collapsible',
        name: 'Collapsible',
        description: 'Expand and reveal repair details or technician notes.',
        Page: CollapsibleDemo,
      },
      {
        id: 'scroll-area',
        name: 'Scroll area',
        description: 'Styled vertical and horizontal scrolling for repair lists.',
        Page: ScrollAreaDemo,
      },
      {
        id: 'resizable',
        name: 'Resizable panels',
        description: 'Horizontal and vertical resizable repair-detail panels.',
        Page: ResizableDemo,
      },
      {
        id: 'aspect-ratio',
        name: 'Aspect ratio',
        description: 'Fixed-ratio containers for device imagery.',
        Page: AspectRatioDemo,
      },
    ],
  },
  {
    name: 'Charts',
    entries: [
      {
        id: 'chart',
        name: 'Chart',
        description: 'Token-driven repair-volume and revenue visualizations.',
        Page: ChartDemo,
      },
    ],
  },
];

export const ALL_ENTRIES: PreviewEntry[] = [
  OVERVIEW_ENTRY,
  ...NAV_GROUPS.flatMap((group) => group.entries),
];

// A duplicate id would make one page unreachable (its deep link and highlight
// resolve to the first match), so fail loudly instead of shipping a dead page.
const duplicateIds = ALL_ENTRIES.map((entry) => entry.id).filter(
  (id, index, ids) => ids.indexOf(id) !== index,
);
if (duplicateIds.length > 0) {
  throw new Error(
    `Duplicate preview page id(s): ${[...new Set(duplicateIds)].join(
      ', ',
    )}. Every page id must be unique across all nav groups.`,
  );
}
