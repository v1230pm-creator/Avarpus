import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuthLogin } from '@workspace/api-client-react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertCircle } from 'lucide-react';
import { AvarpusLogo } from '@/components/AvarpusLogo';

const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or Mobile is required'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const login = useAuthLogin();
  
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: '',
      password: '',
    },
  });

  const onSubmit = (data: LoginForm) => {
    setErrorMsg(null);
    login.mutate({
      data: {
        emailOrMobile: data.identifier,
        password: data.password,
      }
    }, {
      onSuccess: (res) => {
        if (res.user.role !== 'super_admin') {
          setErrorMsg('Access denied. Only super administrators can access the release console.');
          return;
        }
        localStorage.setItem('auth_token', res.token);
        setLocation('/');
      },
      onError: (err: any) => {
        setErrorMsg(err.message || 'Invalid credentials');
      }
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <AvarpusLogo className="h-28 w-28 rounded-[1.75rem] shadow-lg mb-4" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Avarpus Release Console</h1>
          <p className="text-muted-foreground mt-2">Sign in to manage and ship over-the-air updates</p>
        </div>
        
        <Card className="border-border/50 shadow-xl">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Enter your super admin credentials</CardDescription>
          </CardHeader>
          <CardContent>
            {errorMsg && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="identifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email or Mobile</FormLabel>
                      <FormControl>
                        <Input placeholder="admin@avarpus.app" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <Button 
                  type="submit" 
                  className="w-full mt-6" 
                  size="lg"
                  disabled={login.isPending}
                >
                  {login.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Authenticating
                    </>
                  ) : (
                    'Enter Console'
                  )}
                </Button>
              </form>
            </Form>

            <div className="flex items-center justify-between mt-6 text-sm">
              <Link href="/forgot" className="text-primary hover:underline">Forgot password?</Link>
              <Link href="/register" className="text-primary hover:underline">Create account</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}