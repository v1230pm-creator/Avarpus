import { AspectRatio } from '../../components/ui/aspect-ratio';
import { Row } from '../parts';
export function AspectRatioDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Row label="Ratios">
        <div className="w-72">
          <AspectRatio ratio={16 / 9}>
            <div className="flex h-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              iPhone 13 intake photo · 16:9
            </div>
          </AspectRatio>
        </div>
        <div className="w-40">
          <AspectRatio ratio={1}>
            <div className="flex h-full items-center justify-center rounded-lg bg-muted text-center text-sm text-muted-foreground">
              Device detail
              <br />
              1:1
            </div>
          </AspectRatio>
        </div>
      </Row>
    </div>
  );
}
