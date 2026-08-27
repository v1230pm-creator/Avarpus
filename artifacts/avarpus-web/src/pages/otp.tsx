import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  authMeUpdate,
  authOtpResend,
  authOtpVerify,
  getAuthMeQueryKey,
  getChatRoomsListQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function errorMessage(error: any, fallback: string) {
  return error?.data?.message || error?.message || fallback;
}

function verificationErrorMessage(error: any) {
  const message = errorMessage(error, "Verification failed. Please try again.");
  const errorCode = error?.data?.code || error?.code;

  if (errorCode === "OTP_EXPIRED" || /expired/i.test(message)) {
    return "This verification code may have expired. Wait for the resend timer to finish, then choose “Resend code” to request a fresh code.";
  }

  return message;
}

export function OtpPage() {
  const [, setLocation] = useLocation();
  const { setSession, apiConfigurationError } = useAuth();
  const queryClient = useQueryClient();
  const mobile = useMemo(() => new URLSearchParams(window.location.search).get("mobile") || "", []);
  const isDisplayNameSetup = useMemo(
    () => new URLSearchParams(window.location.search).get("setup") === "display-name",
    [],
  );
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [seconds, setSeconds] = useState(60);
  const [needsDisplayName, setNeedsDisplayName] = useState(isDisplayNameSetup);
  const [displayName, setDisplayName] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);

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
      const session = await authOtpVerify({ mobile, code, rememberMe: true, deviceInfo: "Web Browser" });
      setSession(session.token);
      if (session.needsDisplayName) {
        setNeedsDisplayName(true);
      } else {
        setLocation("/");
      }
    } catch (err) {
      setError(verificationErrorMessage(err));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSaveDisplayName = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = displayName.normalize("NFC").trim();
    if (!trimmed) {
      setError("Please enter a display name.");
      return;
    }
    if (Array.from(trimmed).length > 120) {
      setError("Display name must be 120 characters or fewer.");
      return;
    }
    if (/[\u0000-\u001F\u007F-\u009F\u061C\u200E-\u200F\u202A-\u202E\u2066-\u2069<>]/u.test(trimmed)) {
      setError("Display name contains unsupported characters.");
      return;
    }
    setIsSavingName(true);
    setError("");
    try {
      await authMeUpdate({ name: trimmed });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getChatRoomsListQueryKey() }),
      ]);
      setLocation("/");
    } catch (err) {
      setError(errorMessage(err, "Could not save your display name. Please try again."));
    } finally {
      setIsSavingName(false);
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
        {!needsDisplayName && (
          <button
            type="button"
            aria-label="Back to mobile number"
            className="auth-back-button"
            onClick={() => setLocation("/login?step=phone")}
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <span className="auth-step">{needsDisplayName ? "Profile" : "Verification"}</span>
      </header>
      <main className="auth-main auth-main-phone">
        <div className="auth-copy">
          <p className="auth-eyebrow">{needsDisplayName ? "Make it yours" : "Almost there"}</p>
          <h1>{needsDisplayName ? "Choose your display name" : "Enter your verification code"}</h1>
          <p className="auth-lede">
            {needsDisplayName
              ? "This is how you will appear in conversations."
              : <>Enter the 6-digit code sent to <strong>+91 {mobile}</strong>.</>}
          </p>
        </div>
        {needsDisplayName ? (
          <form className="auth-form" onSubmit={handleSaveDisplayName}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <label className="auth-label" htmlFor="display-name">Display name</label>
            <Input
              id="display-name"
              type="text"
              autoComplete="name"
              autoFocus
              maxLength={120}
              placeholder="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value.slice(0, 120))}
              disabled={isSavingName}
            />
            <p className="text-sm text-muted-foreground">Use a name your contacts will recognize.</p>
            <Button className="auth-primary-button" type="submit" disabled={isSavingName}>
              {isSavingName ? "Saving..." : "Continue"}
              {!isSavingName && <ArrowRight className="size-4" />}
            </Button>
          </form>
        ) : (
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
        )}
      </main>
    </div>
  );
}