import { useListAppUpdates } from "@workspace/api-client-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/utils";
import { 
  PlusCircle, 
  Download,
  Smartphone,
  Calendar,
  Package,
  Loader2
} from "lucide-react";

export default function Releases() {
  const { data, isLoading } = useListAppUpdates();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const updates = data?.updates || [];

  return (
    <div className="flex-1 p-6 md:p-8 overflow-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Releases</h1>
          <p className="text-muted-foreground mt-1">Manage all versions of the Avarpus Android app.</p>
        </div>
        <Button asChild>
          <Link href="/releases/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Release
          </Link>
        </Button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/50 border-b">
              <tr>
                <th className="px-6 py-4 font-medium">Version</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium">Details</th>
                <th className="px-6 py-4 font-medium">Downloads</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {updates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center">
                      <Package className="h-10 w-10 mb-4 opacity-20" />
                      <p>No releases found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                updates.map((update, idx) => (
                  <tr 
                    key={update.id} 
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors animate-in fade-in slide-in-from-bottom-2`}
                    style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'both' }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-md ${update.status === 'published' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                          <Smartphone className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-bold text-base">v{update.version}</div>
                          <div className="text-muted-foreground">Build {update.buildNumber}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {update.status === 'published' && <Badge variant="success">Published</Badge>}
                      {update.status === 'draft' && <Badge variant="secondary">Draft</Badge>}
                      {update.status === 'archived' && <Badge variant="outline">Archived</Badge>}
                      {update.status === 'unpublished' && <Badge variant="warning">Unpublished</Badge>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={update.updateType === 'critical' ? 'destructive' : update.updateType === 'recommended' ? 'warning' : 'outline'}>
                        {update.updateType}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1 text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{format(new Date(update.createdAt), 'MMM d, yyyy')}</span>
                        </div>
                        <div className="text-xs">
                          {update.apkSize ? formatBytes(update.apkSize) : 'No APK'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{update.downloadCount}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <Button variant="outline" size="sm" className="mr-2" asChild>
                        <Link href={`/releases/${update.id}`}>View</Link>
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}