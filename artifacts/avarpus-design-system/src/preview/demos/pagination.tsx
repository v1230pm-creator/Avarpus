import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../../components/ui/pagination';
import { Row, Stack } from '../parts';
export function PaginationDemo() {
  return (
    <div className="space-y-8 rounded-xl border bg-card p-6 text-card-foreground">
      <Stack label="Repair results">
        <p className="text-sm text-muted-foreground">Showing tickets 21–30 of 86</p>
        <Row>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#previous" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#page-1">1</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#page-3" isActive>
                  3
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#page-4" size="sm">
                  4
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#next" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </Row>
      </Stack>
    </div>
  );
}
