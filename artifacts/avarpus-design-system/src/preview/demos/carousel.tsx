import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '../../components/ui/carousel';
import { Row } from '../parts';
const REPAIRS = [
  { id: 'RP-1042', device: 'iPhone 13', amount: '₹2,400' },
  { id: 'RP-1041', device: 'Redmi Note 12', amount: '₹850' },
  { id: 'RP-1039', device: 'Galaxy A54', amount: '₹0' },
];
export function CarouselDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Horizontal">
        <Carousel className="mx-12 w-full max-w-md" opts={{ loop: true }}>
          <CarouselContent>
            {REPAIRS.map((repair) => (
              <CarouselItem key={repair.id} className="md:basis-1/2">
                <div className="rounded-lg border bg-background p-6">
                  <p className="text-sm text-muted-foreground">{repair.id}</p>
                  <p className="mt-1 font-medium">{repair.device}</p>
                  <p className="mt-4 tabular-nums">{repair.amount}</p>
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </Row>
      <Row label="Vertical">
        <Carousel
          orientation="vertical"
          className="mx-12 w-full max-w-sm"
          opts={{ align: 'start' }}
        >
          <CarouselContent className="h-40">
            {REPAIRS.map((repair) => (
              <CarouselItem key={repair.id} className="basis-1/2">
                <div className="rounded-lg bg-muted p-4 text-sm">
                  {repair.id} · {repair.device}
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious />
          <CarouselNext />
        </Carousel>
      </Row>
    </div>
  );
}
