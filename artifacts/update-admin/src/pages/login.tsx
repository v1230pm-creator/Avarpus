import { useState } from 'react';
import { useLocation } from 'wouter';
import { authOtpRequest, authOtpVerify } from '@workspace/api-client-react';
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

const mobileSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit mobile number'),
});

type MobileForm = z.infer<typeof mobileSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);

  const form = useForm<MobileForm>({
    resolver: zodResolver(mobileSchema),
    defaultValues: { mobile: '' },
  });

  const requestOtp = async (data: MobileForm) => {
    setErrorMsg(null);
    setPending(true);
    try {
      await authOtpRequest({ mobile: data.mobile });
      setMobile(data.mobile);
      setStep('otp');
    } catch (err: any) {
      setErrorMsg(err?.data?.message ?? err?.message ?? 'Could not send a verification code.');
    } finally {
      setPending(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    if (!/^\d{6}$/.test(code)) {
      setErrorMsg('Enter the 6-digit verification code.');
      return;
    }
    setPending(true);
    try {
      const session = await authOtpVerify({
        mobile,
        code,
        rememberMe: true,
        device: 'Avarpus Release Console',
      });
      if (session.user.role !== 'super_admin') {
        setErrorMsg('Access denied. Only super administrators can access the release console.');
        return;
      }
      localStorage.setItem('auth_token', session.token);
      setLocation('/');
    } catch (err: any) {
      setErrorMsg(err?.data?.message ?? err?.message ?? 'Invalid or expired verification code.');
    } finally {
      setPending(false);
    }
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
            <CardTitle>Secure Sign In</CardTitle>
            <CardDescription>
              {step === 'mobile'
                ? 'Enter the mobile number registered to your super admin account.'
                : `Enter the verification code sent to ${mobile}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errorMsg && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
            
            {step === 'mobile' ? (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(requestOtp)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="mobile"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Mobile number</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="9876543210"
                            inputMode="numeric"
                            autoComplete="tel"
                            {...field}
                            onChange={(event) => field.onChange(event.target.value.replace(/\D/g, '').slice(0, 10))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full mt-6" size="lg" disabled={pending}>
                    {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Sending code</> : 'Send verification code'}
                  </Button>
                </form>
              </Form>
            ) : (
              <form onSubmit={verifyOtp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">Verification code</Label>
                  <Input
                    id="otp"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full mt-6" size="lg" disabled={pending}>
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Verifying</> : 'Enter console'}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={() => setStep('mobile')}>
                  Use a different mobile number
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}