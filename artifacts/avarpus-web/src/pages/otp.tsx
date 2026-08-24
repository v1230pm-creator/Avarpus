import { useEffect, useMemo, useState } from "react";
import { authOtpResend, authOtpVerify } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function errorMessage(error: any, fallback: string) {
  return error?.data?.message || error?.message || fallback;
}

export function OtpPage() {
  const [, setLocation] = useLocation();
  const { setSession, apiConfigurationError } = useAuth();
  const mobile = useMemo(() => new URLSearchParams(window.location.search).get("mobile") || "", []);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (apiConfigurationError) {
      setError(apiConfigurationError);
      return;
    }
    if (!mobile || code.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }
    setIsVerifying(true);
    try {
      const session = await authOtpVerify({ mobile, code, rememberMe: true, device: "Web Browser" });
      setSession(session.token);
      setLocation("/dashboard");
    } catch (err) {
      setError(errorMessage(err, "Verification failed. Please try again."));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (seconds > 0 || !mobile) return;
    setError("");
    setIsResending(true);
    try {
      await authOtpResend({ mobile });
      setSeconds(60);
    } catch (err) {
      setError(errorMessage(err, "Could not resend the code. Please try again."));
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="auth-screen">
      <header className="auth-topbar">
        <button
          type="button"
          aria-label="Back to mobile number"
          className="auth-back-button"
          onClick={() => setLocation("/login?step=phone")}
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="auth-step">Verification</span>
      </header>
      <main className="auth-main auth-main-phone">
        <div className="auth-copy">
          <p className="auth-eyebrow">Almost there</p>
          <h1>Enter your verification code</h1>
          <p className="auth-lede">
            Enter the 6-digit code sent to <strong>+91 {mobile}</strong>.
          </p>
        </div>
        <form className="auth-form" onSubmit={handleVerify}>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <label className="auth-label" htmlFor="verification-code">Verification code</label>
          <Input
            id="verification-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={isVerifying}
            className="auth-otp-input"
          />
          <button type="button" className="auth-resend" onClick={handleResend} disabled={seconds > 0 || isResending}>
            {isResending ? "Sending a new code..." : seconds > 0 ? `Resend code in ${seconds}s` : "Resend code"}
          </button>
          <Button className="auth-primary-button" type="submit" disabled={isVerifying || code.length !== 6 || Boolean(apiConfigurationError)}>
            {isVerifying ? "Verifying..." : "Verify & Continue"}
            {!isVerifying && <ArrowRight className="size-4" />}
          </Button>
        </form>
      </main>
    </div>
  );
}