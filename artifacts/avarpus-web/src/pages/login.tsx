import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAuthLogin } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const [emailOrMobile, setEmailOrMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  
  const { setSession, apiConfigurationError } = useAuth();
  const [, setLocation] = useLocation();

  const loginMutation = useAuthLogin({
    mutation: {
      onSuccess: (data) => {
        setSession(data.token);
        setLocation("/dashboard");
      },
      onError: (err: any) => {
        setError(err.message || "Failed to sign in. Please try again.");
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (apiConfigurationError) {
      setError(apiConfigurationError);
      return;
    }
    if (!emailOrMobile || !password) {
      setError("Please fill in all fields");
      return;
    }
    loginMutation.mutate({
      data: {
        emailOrMobile,
        password,
        device: "Web Browser"
      }
    });
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm border-0 shadow-lg sm:border sm:shadow-sm">
        <form onSubmit={handleSubmit}>
          <CardHeader className="space-y-2 text-center pb-8">
            <div className="mx-auto w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-xl font-bold mb-2">
              A
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Sign in to Avarpus</CardTitle>
            <CardDescription>
              Enter your credentials to access the workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(error || apiConfigurationError) && (
              <div className="p-3 text-sm text-destructive-foreground bg-destructive rounded-md">
                {error || apiConfigurationError}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or Mobile Number</Label>
              <Input 
                id="identifier" 
                type="text" 
                placeholder="name@example.com or +91..." 
                value={emailOrMobile}
                onChange={(e) => setEmailOrMobile(e.target.value)}
                disabled={loginMutation.isPending}
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <span className="text-xs text-primary cursor-pointer hover:underline">Forgot password?</span>
              </div>
              <Input 
                id="password" 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loginMutation.isPending || Boolean(apiConfigurationError)}
                autoComplete="current-password"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="w-full" 
              type="submit" 
              disabled={loginMutation.isPending || Boolean(apiConfigurationError)}
            >
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
