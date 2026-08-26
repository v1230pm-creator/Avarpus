import {
  useAppUpdateStats,
  useAuthOtpProviderStatus,
  useListAppUpdates,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Package, 
  Download, 
  Activity, 
  FileText, 
  Smartphone,
  PlusCircle,
  ArrowRight,
  Loader2,
  MessageSquareText,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: statsEnvelope, isLoading: statsLoading } = useAppUpdateStats();
  const stats = statsEnvelope?.stats;
  const { data: recentReleases, isLoading: releasesLoading } = useListAppUpdates();
  const {
    data: otpProvider,
    isLoading: otpProviderLoading,
    isError: otpProviderError,
  } = useAuthOtpProviderStatus();

  if (statsLoading || releasesLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const liveRelease = recentReleases?.updates?.find(u => u.status === 'published');
  const drafts = recentReleases?.updates?.filter(u => u.status === 'draft') || [];

  return (
    <div className="flex-1 p-6 md:p-8 overflow-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Overview of app releases and user adoption.</p>
        </div>
        <Button asChild>
          <Link href="/releases/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Release
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card className="bg-primary text-primary-foreground border-primary">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Downloads</CardTitle>
            <Download className="h-4 w-4 opacity-75" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.totalDownloads.toLocaleString() || 0}</div>
            <p className="text-xs opacity-75 mt-1">Across all versions</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Update Checks</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats?.totalUpdateChecks.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Total API pings</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Published</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats?.publishedCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Live or archived versions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Drafts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{stats?.draftCount || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending releases</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-primary" />
              Mobile OTP provider
            </CardTitle>
            <CardDescription className="mt-1">
              Server-only delivery configuration used by mobile, web, and this release console.
            </CardDescription>
          </div>
          {otpProviderLoading ? (
            <Badge variant="outline">Checking</Badge>
          ) : otpProvider?.configured ? (
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              Configured
            </Badge>
          ) : (
            <Badge variant="destructive">
              <AlertTriangle className="mr-1 h-3.5 w-3.5" />
              Setup required
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {otpProviderError ? (
            <p className="text-sm text-destructive">
              Provider status could not be loaded. Check the API server and your administrator session.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Provider</p>
                <p className="mt-1 font-semibold">{otpProvider?.provider ?? "Hanu OTP"}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template (optional)</p>
                <p className="mt-1 font-mono text-sm">{otpProvider?.templateId || "Provider default"}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">API credential</p>
                <p className="mt-1 flex items-center gap-2 font-semibold">
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                  {otpProvider?.apiKeyConfigured ? "Stored securely" : "Not configured"}
                </p>
              </div>
            </div>
          )}
          {!otpProviderLoading && !otpProvider?.apiKeyConfigured && !otpProviderError && (
            <p className="mt-4 text-sm text-muted-foreground">
              Add <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">HANU_OTP_API_KEY</code>{" "}
              as a Replit Secret. A template ID is optional; the API key is never returned to this page or bundled into the apps.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>Current Live Release</CardTitle>
            <CardDescription>The version currently being distributed to staff phones.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            {liveRelease ? (
              <div className="flex flex-col items-center text-center p-6 border rounded-xl bg-muted/30">
                <div className="h-16 w-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center mb-4 text-emerald-600 dark:text-emerald-400">
                  <Smartphone className="h-8 w-8" />
                </div>
                <h3 className="text-2xl font-bold">v{liveRelease.version}</h3>
                <p className="text-sm text-muted-foreground mb-4">Build {liveRelease.buildNumber}</p>
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  <Badge variant={liveRelease.updateType === 'critical' ? 'destructive' : liveRelease.updateType === 'recommended' ? 'warning' : 'secondary'}>
                    {liveRelease.updateType.toUpperCase()}
                  </Badge>
                  <Badge variant="outline" className="bg-background">
                    Min API: {liveRelease.minAndroidVersion || 'Any'}
                  </Badge>
                </div>
                <div className="w-full grid grid-cols-2 gap-4 mt-2 border-t pt-4">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Downloads</div>
                    <div className="text-lg font-bold">{liveRelease.downloadCount}</div>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">Published</div>
                    <div className="text-sm mt-1">{liveRelease.publishedAt ? format(new Date(liveRelease.publishedAt), 'MMM d, yyyy') : 'Unknown'}</div>
                  </div>
                </div>
                <Button variant="outline" className="w-full mt-6" asChild>
                  <Link href={`/releases/${liveRelease.id}`}>View Details</Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Package className="h-12 w-12 mb-4 opacity-20" />
                <p>No live release currently published.</p>
                <Button variant="link" className="mt-4" asChild>
                  <Link href="/releases/new">Create the first release</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Drafts</CardTitle>
              <CardDescription>Unpublished releases being prepared.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="hidden sm:flex" asChild>
              <Link href="/releases">
                View All <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {drafts.length > 0 ? (
              <div className="space-y-4">
                {drafts.slice(0, 4).map(draft => (
                  <Link key={draft.id} href={`/releases/${draft.id}`}>
                    <div className="flex items-center justify-between p-4 border rounded-lg hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer group">
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          v{draft.version} 
                          <span className="text-xs font-normal text-muted-foreground">Build {draft.buildNumber}</span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          Created {format(new Date(draft.createdAt), 'MMM d')}
                        </div>
                      </div>
                      <div className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-5 w-5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <FileText className="h-12 w-12 mb-4 opacity-20" />
                <p>No drafts currently in progress.</p>
              </div>
            )}
            
            <div className="mt-6 sm:hidden">
              <Button variant="outline" className="w-full" asChild>
                <Link href="/releases">
                  View All Releases
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}