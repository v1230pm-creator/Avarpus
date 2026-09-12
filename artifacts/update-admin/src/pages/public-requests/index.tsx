import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  usePublicRequestAdminList,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionLoader, Spinner } from "@/components/ui/spinner";
import { Search, Inbox, Calendar, ShieldAlert, FileText, ArrowRight, AlertCircle } from "lucide-react";

export default function PublicRequests() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);

  const { data, isLoading, isFetching, error } = usePublicRequestAdminList({
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    kind: kindFilter !== "all" ? kindFilter as any : undefined,
    search: searchQuery || undefined,
    cursor,
  });
  const searchBusy = isFetching && searchQuery.trim().length > 0;

  const resetPagination = () => {
    setCursor(undefined);
    setPreviousCursors([]);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "received": return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Received</Badge>;
      case "in_review": return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">In Review</Badge>;
      case "resolved": return <Badge variant="success" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">Resolved</Badge>;
      case "rejected": return <Badge variant="destructive">Rejected</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getKindBadge = (kind: string) => {
    if (kind === "account_deletion") {
      return (
        <Badge variant="outline" className="text-red-600 border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20">
          <ShieldAlert className="h-3 w-3 mr-1" /> Account Deletion
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-slate-600 border-slate-200 dark:border-slate-800 dark:text-slate-300 bg-slate-50 dark:bg-slate-900">
        <FileText className="h-3 w-3 mr-1" /> Support
      </Badge>
    );
  };

  return (
    <div className="flex-1 p-6 md:p-8 overflow-auto bg-slate-50/50 dark:bg-slate-950/50 min-h-screen animate-in fade-in duration-300">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Public Requests</h1>
            <p className="text-muted-foreground mt-1">Review and triage incoming support and deletion requests.</p>
          </div>
        </div>

        <Card className="shadow-sm border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <span className="pointer-events-none absolute left-8 top-2.5 flex size-4 items-center justify-center">
                  {searchBusy ? <Spinner size={14} label={null} /> : null}
                </span>
                <Input
                  placeholder="Search by name, email, or mobile..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    resetPagination();
                  }}
                  className="pl-14 bg-card"
                />
              </div>
              <div className="flex items-center gap-2">
                <Select value={kindFilter} onValueChange={(value) => {
                  setKindFilter(value);
                  resetPagination();
                }}>
                  <SelectTrigger className="w-[180px] bg-card">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="support">Support</SelectItem>
                    <SelectItem value="account_deletion">Account Deletion</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => {
                  setStatusFilter(value);
                  resetPagination();
                }}>
                  <SelectTrigger className="w-[160px] bg-card">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="received">Received</SelectItem>
                    <SelectItem value="in_review">In Review</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <SectionLoader message="Loading queue..." />
            ) : error ? (
              <div className="flex flex-col items-center justify-center p-12 text-destructive">
                <AlertCircle className="h-10 w-10 mb-4 opacity-50" />
                <p>Failed to load requests. Please try again.</p>
              </div>
            ) : !data?.requests?.length ? (
              <div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground">
                <div className="h-16 w-16 bg-slate-100 dark:bg-slate-900 rounded-full flex items-center justify-center mb-4">
                  <Inbox className="h-8 w-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">Queue is empty</h3>
                <p className="mt-1">No requests match your current filters.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.requests.map((request, idx) => (
                  <Link key={request.id} href={`/public-requests/${request.id}`}>
                    <div 
                      className="group flex flex-col md:flex-row md:items-center justify-between p-4 sm:px-6 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors cursor-pointer animate-in fade-in slide-in-from-bottom-2"
                      style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                    >
                      <div className="flex items-start gap-4">
                        <div className="hidden sm:flex mt-1">
                          <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 font-medium">
                            {request.requesterName.charAt(0).toUpperCase()}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {request.requesterName}
                            </span>
                            <span className="text-sm text-slate-500">• {request.mobile}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {getKindBadge(request.kind)}
                            {getStatusBadge(request.status)}
                          </div>
                          {request.subject && (
                            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-1 mt-1.5">
                              {request.subject}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between md:flex-col md:items-end mt-4 md:mt-0 gap-2">
                        <div className="flex items-center text-sm text-slate-500 gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(request.createdAt), 'MMM d, yyyy HH:mm')}
                        </div>
                        <div className="text-primary opacity-0 group-hover:opacity-100 transition-opacity flex items-center text-sm font-medium">
                          Review <ArrowRight className="ml-1 h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {(previousCursors.length > 0 || data.nextCursor) && (
                  <div className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6">
                    <Button
                      variant="outline"
                      disabled={isLoading || previousCursors.length === 0}
                      onClick={() => {
                        const nextHistory = previousCursors.slice(0, -1);
                        setCursor(previousCursors[previousCursors.length - 1]);
                        setPreviousCursors(nextHistory);
                      }}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Page {previousCursors.length + 1}
                    </span>
                    <Button
                      variant="outline"
                      disabled={isLoading || !data.nextCursor}
                      onClick={() => {
                        if (!data.nextCursor) return;
                        setPreviousCursors((history) => [...history, cursor]);
                        setCursor(data.nextCursor);
                      }}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
