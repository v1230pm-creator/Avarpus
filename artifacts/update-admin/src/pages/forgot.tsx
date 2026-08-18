import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuthForgotRequest, useAuthForgotVerify, useAuthForgotReset } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { KeyRound, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

type Step = 'email' | 'code' | 'reset' | 'done';

export default function Forgot() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const request = useAuthForgotRequest();
  const verify = useAuthForgotVerify();
  const reset = useAuthForgotReset();

  const pending = request.isPending || verify.isPending || reset.isPending;

  const onRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    request.mutate({ data: { email: email.trim() } }, {
      onSuccess: () => setStep('code'),
      onError: (err: any) => setErrorMsg(err.message || 'Failed to send code'),
    });
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    verify.mutate({ data: { email: email.trim(), code: code.trim() } }, {
      onSuccess: (res) => {
        setResetToken(res.resetToken);
        setStep('reset');
      },
      onError: (err: any) => setErrorMsg(err.message || 'Invalid or expired code'),
    });
  };

  const onReset = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    reset.mutate({ data: { email: email.trim(), resetToken, newPassword } }, {
      onSuccess: () => setStep('done'),
      onError: (err: any) => setErrorMsg(err.message || 'Failed to reset password'),
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="h-16 w-16 bg-primary rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-primary/20">
            <KeyRound className="h-8 w-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Reset Password</h1>
          <p className="text-muted-foreground mt-2">We'll email you a verification code</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader>
            <CardTitle>
              {step === 'email' && 'Forgot your password?'}
              {step === 'code' && 'Check your email'}
              {step === 'reset' && 'Choose a new password'}
              {step === 'done' && 'Password updated'}
            </CardTitle>
            <CardDescription>
              {step === 'email' && 'Enter the email linked to your account'}
              {step === 'code' && `We sent a 6-digit code to ${email}`}
              {step === 'reset' && 'Minimum 8 characters with uppercase, lowercase and a number'}
              {step === 'done' && 'You can now sign in with your new password'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errorMsg && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}

            {step === 'email' && (
              <form onSubmit={onRequest} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" disabled={pending}>
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Sending code</> : 'Send Code'}
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
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Verifying</> : 'Verify Code'}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={pending}
                  onClick={() => {
                    setErrorMsg(null);
                    request.mutate({ data: { email: email.trim() } }, {
                      onError: (err: any) => setErrorMsg(err.message || 'Could not resend code'),
                    });
                  }}>
                  Resend code
                </Button>
                <Button type="button" variant="ghost" className="w-full" disabled={pending}
                  onClick={() => { setStep('email'); setCode(''); }}>
                  Use a different email
                </Button>
              </form>
            )}

            {step === 'reset' && (
              <form onSubmit={onReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input id="newPassword" type="password" required placeholder="••••••••"
                    value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input id="confirmPassword" type="password" required placeholder="••••••••"
                    value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full mt-2" size="lg" disabled={pending}>
                  {pending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Updating</> : 'Update Password'}
                </Button>
              </form>
            )}

            {step === 'done' && (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>Your password has been changed successfully.</AlertDescription>
                </Alert>
                <Button className="w-full" size="lg" onClick={() => setLocation('/login')}>
                  Back to Sign In
                </Button>
              </div>
            )}

            {step !== 'done' && (
              <p className="text-sm text-muted-foreground text-center mt-6">
                Remembered it? <Link href="/login" className="text-primary hover:underline">Sign in</Link>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
