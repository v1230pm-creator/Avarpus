import { useChatRoomsList } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";

export function ChatsPage() {
  const { data, isLoading } = useChatRoomsList();
  const { user } = useAuth();
  // The server remains the authorization authority. This client-side filter
  // additionally keeps a customer landing free of dealer/staff room types if
  // a mixed room list is ever returned.
  const rooms =
    user?.role === "customer"
      ? (data?.rooms ?? []).filter(
          (room: any) => room.kind === "customer" || room.kind === "direct",
        )
      : data?.rooms ?? [];

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chats</h1>
          <p className="text-muted-foreground">
            {user?.role === "customer"
              ? "Your customer and direct conversations."
              : "Customer and internal conversations."}
          </p>
        </div>
      </div>
      
      <div className="border rounded-md bg-card flex-1 overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading chats...</div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 p-8 text-center border-dashed border-2 m-4 rounded-xl">
            <h3 className="text-lg font-semibold mb-1">No active conversations</h3>
            <p className="text-muted-foreground max-w-sm">When customers message you from their portal, they will appear here.</p>
          </div>
        ) : (
          <div className="flex h-full">
            <div className="w-1/3 border-r flex flex-col">
              <div className="p-4 border-b font-medium">Conversations</div>
              <div className="flex-1 overflow-y-auto">
                {rooms.map((room: any) => (
                  <div key={room.id} className="p-4 border-b hover:bg-muted/50 cursor-pointer">
                    <div className="flex justify-between items-start mb-1">
                      <h4 className="font-semibold text-sm truncate">{room.name}</h4>
                      {room.lastMessageAt && (
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                          {format(new Date(room.lastMessageAt), 'MMM d')}
                        </span>
                      )}
                    </div>
                    {room.lastMessageBody && (
                      <p className="text-xs text-muted-foreground truncate">{room.lastMessageBody}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center bg-muted/20 text-muted-foreground">
              Select a conversation to start messaging
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
