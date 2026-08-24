import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">View your profile and account identity.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your verified contact details are managed by Avarpus support.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={user?.name || ""} readOnly />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input defaultValue={user?.email || ""} disabled />
            <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
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
