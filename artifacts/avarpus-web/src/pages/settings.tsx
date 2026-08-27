import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authMeUpdate, getAuthMeQueryKey, getChatRoomsListQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name || "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setName(user?.name || "");
  }, [user?.name]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.normalize("NFC").trim();
    if (!trimmed) {
      setError("Name cannot be empty.");
      setMessage("");
      return;
    }
    if (Array.from(trimmed).length > 120) {
      setError("Name must be 120 characters or fewer.");
      setMessage("");
      return;
    }
    if (/[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069<>]/u.test(trimmed)) {
      setError("Name contains unsupported characters.");
      setMessage("");
      return;
    }
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      await authMeUpdate({ name: trimmed });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
      ]);
      setMessage("Profile updated.");
    } catch (err: any) {
      setError(err?.data?.message || err?.message || "Could not update your profile.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">View your profile and account identity.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your saved account identity is protected and managed by Avarpus.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-2" onSubmit={saveName}>
            <Label htmlFor="profile-name">Name</Label>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value.slice(0, 120))}
                disabled={isSaving}
              />
              <Button type="submit" disabled={isSaving || name.trim() === (user?.name || "").trim()}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">This name appears in conversations and can be changed anytime.</p>
            {message && <p className="text-sm text-green-600" role="status">{message}</p>}
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </form>
          <div className="space-y-2">
            <Label>Backup email identity</Label>
            <Input defaultValue={user?.email || ""} disabled />
            <p className="text-xs text-muted-foreground">Recovery-only: this saved email protects your existing account data. Sign-in uses mobile OTP.</p>
          </div>
          <div className="space-y-2">
            <Label>Mobile</Label>
            <Input defaultValue={user?.mobile || ""} disabled />
            <p className="text-xs text-muted-foreground">Mobile cannot be changed.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
