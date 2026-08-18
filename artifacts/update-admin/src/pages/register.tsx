import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuthRegisterStart, useAuthRegisterVerify } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { UserPlus, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

type Step = 'details' | 'code' | 'done';

export default function Register() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [shopAddress, setShopAddress] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const start = useAuthRegisterStart();
  const verify = useAuthRegisterVerify();
  const pending = start.isPending || verify.isPending;

  const onStart = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    start.mutate({
      data: {
        name: name.trim(),
        businessName: businessName.trim(),
        shopAddress: shopAddress.trim(),
        email: email.trim(),
        mobile: mobile.trim(),
        password,
      },
    }, {
      onSuccess: () => setStep('code'),
      onError: (err: any) => setErrorMsg(err.message || 'Registration failed'),
    });
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    verify.mutate({ data: { email: email.trim(), code: code.trim() } }, {
      onSuccess: () => setStep('done'),
      onError: (err: any) => setErrorMsg(err.message || 'Invalid or expired code'),
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="h-16 w-16 bg-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
            <UserPlus className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Create Account</h1>
          <p className="text-muted-foreground mt-2">Register for VMC Electronic BMS</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader>
            <CardTitle>
              {step === 'details' && 'Your details'}
              {step === 'code' && 'Verify your email'}
              {step === 'done' && 'Account created'}
            </CardTitle>
            <CardDescription>
              {step === 'details' && 'Password: minimum 8 characters with uppercase, lowercase and a number'}
              {step === 'code' && `We sent a 6-digit code to ${email}`}
              {step === 'done' && 'Your account is ready'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errorMsg && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {step === 'details' && (
              <form onSubmit={onStart} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input id="name" required placeholder="Your name"
                    value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="businessName">Business / shop name</Label>
                  <Input id="businessName" required placeholder="Your shop name"
                    value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shopAddress">Shop address</Label>
                  <Input id="shopAddress" required placeholder="Shop address"
                    value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mobile">Mobile (10 digits)</Label>
                  <Input id="mobile" inputMode="numeric" required placeholder="9876543210" maxLength={10}
                    value={mobile} onChange={(e) => setMobile(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" required placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input id="confirmPassword" type="password" required placeholder="••••••••"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" disabled={pending}>
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Sending code</> : 'Continue'}
                </Button>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={onVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input id="code" inputMode="numeric" required placeholder="123456" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" disabled={pending}>
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Verifying</> : 'Verify & Create Account'}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={pending}
                  onClick={() => {
                    setErrorMsg(null);
                    start.mutate({
                      data: {
                        name: name.trim(),
                        businessName: businessName.trim(),
                        shopAddress: shopAddress.trim(),
                        email: email.trim(),
                        mobile: mobile.trim(),
                        password,
                      },
                    }, {
                      onSuccess: () => setErrorMsg(null),
                      onError: (err: any) => setErrorMsg(err.message || 'Could not resend code'),
                    });
                  }}>
                  Resend code
                </Button>
                <Button type="button" variant="ghost" className="w-full" disabled={pending}
                  onClick={() => { setStep('details'); setCode(''); }}>
                  Edit details
                </Button>
              </form>
            )}

            {step === 'done' && (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Account created successfully. Note: the Release Console itself is restricted to
                    super admin accounts — use the VMC mobile app to sign in, or contact the
                    administrator for console access.
                  </AlertDescription>
                </Alert>
                <Button className="w-full" size="lg" onClick={() => setLocation('/login')}>
                  Go to Sign In
                </Button>
              </div>
            )}

            {step !== 'done' && (
              <p className="text-sm text-muted-foreground text-center mt-6">
                Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
