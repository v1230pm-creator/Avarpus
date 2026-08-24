import { useNotificationsList, useNotificationsMarkRead } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Check } from "lucide-react";

export function NotificationsPage() {
  const { data, isLoading, refetch } = useNotificationsList();
  const markRead = useNotificationsMarkRead({
    mutation: { onSuccess: () => refetch() }
  });

  const handleMarkAll = () => {
    markRead.mutate({ data: {} });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">Recent alerts and system messages.</p>
        </div>
        <Button variant="outline" onClick={handleMarkAll} disabled={markRead.isPending}>
          <Check className="mr-2 h-4 w-4" />
          Mark all as read
        </Button>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4 h-24 bg-muted/50" />
            </Card>
          ))
        ) : data?.notifications.length === 0 ? (
          <div className="h-32 flex items-center justify-center border border-dashed rounded-lg text-muted-foreground">
            No notifications.
          </div>
        ) : (
          data?.notifications.map((item: any) => (
            <Card key={item.id} className={!item.read ? 'border-primary/50 bg-primary/5' : ''}>
              <CardContent className="p-4 flex gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className={`text-sm font-semibold ${!item.read ? 'text-primary' : ''}`}>
                      {item.title}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(item.createdAt), 'MMM d, h:mm a')}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </div>
                {!item.read && (
                  <Button variant="ghost" size="icon" onClick={() => markRead.mutate({ data: { ids: [item.id] }})}>
                    <Check className="h-4 w-4" />
                  </Button>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
