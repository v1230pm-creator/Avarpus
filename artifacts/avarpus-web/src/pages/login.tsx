import { useEffect, useState } from "react";
import { authOtpRequest } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { ArrowRight, Check, ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function errorMessage(error: any, fallback: string) {
  return error?.data?.message || error?.message || fallback;
}

export function LoginPage() {
  const [, setLocation] = useLocation();
  const { apiConfigurationError } = useAuth();
  const [mobile, setMobile] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Wouter's location hook intentionally tracks the path, not query-string
  // changes. Keep this step in React state so the same /login route updates
  // immediately after users accept the terms.
  const [isPhoneStep, setIsPhoneStep] = useState(
    () => new URLSearchParams(window.location.search).get("step") === "phone",
  );
  const hasAcceptedTerms = sessionStorage.getItem("avarpus_terms_accepted") === "true";

  useEffect(() => {
    if (isPhoneStep && !hasAcceptedTerms) {
      setIsPhoneStep(false);
      setLocation("/login");
    }
  }, [hasAcceptedTerms, isPhoneStep, setLocation]);

  const continueToPhone = () => {
    setError("");
    if (!accepted) {
      setError("Please agree to the Terms and Conditions to continue.");
      return;
    }
    sessionStorage.setItem("avarpus_terms_accepted", "true");
    setIsPhoneStep(true);
    setLocation("/login?step=phone");
  };

  const handleSendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const digits = mobile.replace(/\D/g, "");
    if (apiConfigurationError) {
      setError(apiConfigurationError);
      return;
    }
    if (digits.length !== 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setIsSending(true);
    try {
      await authOtpRequest({ mobile: digits });
      setLocation(`/verify?mobile=${encodeURIComponent(digits)}`);
    } catch (err) {
      setError(errorMessage(err, "Could not send OTP. Please try again."));
    } finally {
      setIsSending(false);
    }
  };

  if (isPhoneStep && hasAcceptedTerms) {
    return (
      <div className="auth-screen">
        <header className="auth-topbar">
          <button
            type="button"
            aria-label="Back to welcome"
            className="auth-back-button"
            onClick={() => {
              setIsPhoneStep(false);
              setLocation("/login");
            }}
          >
            <ChevronLeft className="size-5" />
          </button>
          <span className="auth-step">2 of 2</span>
        </header>

        <main className="auth-main auth-main-phone">
          <div className="auth-copy">
            <p className="auth-eyebrow">Avarpus secure sign in</p>
            <h1>Enter your mobile number</h1>
            <p className="auth-lede">
              We will send a one-time code to verify your account and continue securely.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSendOtp}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <label className="auth-label" htmlFor="mobile-number">Mobile number</label>
            <div className="auth-phone-input">
              <span className="auth-country-code" aria-hidden="true">+91</span>
              <Input
                id="mobile-number"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                autoFocus
                maxLength={10}
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(event) => setMobile(event.target.value.replace(/\D/g, "").slice(0, 10))}
                disabled={isSending}
                aria-describedby="mobile-help"
              />
            </div>
            <p id="mobile-help" className="auth-helper">
              Use the mobile number registered with your Avarpus account.
            </p>
            <div className="auth-sim-notice" role="note">
              <ShieldCheck className="size-4" />
              <span>SIM-verified sign-in is available in the Avarpus Android app. Browsers cannot send a verification SMS from your SIM.</span>
            </div>
            <Button className="auth-primary-button" type="submit" disabled={isSending || Boolean(apiConfigurationError)}>
              {isSending ? "Sending code..." : "Continue"}
              {!isSending && <ArrowRight className="size-4" />}
            </Button>
            <p className="auth-privacy">
              By continuing, you agree to receive a verification code by SMS.
            </p>
          </form>
        </main>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <header className="auth-topbar">
        <span className="auth-wordmark">AVARPUS</span>
        <span className="auth-step">1 of 2</span>
      </header>

      <main className="auth-main auth-main-welcome">
        <div className="auth-welcome-copy">
          <p className="auth-eyebrow">A calmer way to run your shop</p>
          <h1>Welcome to Avarpus</h1>
          <p className="auth-lede">
            Your trusted workspace for repairs, customers, inventory, and the people who keep your business moving.
          </p>
        </div>

        <div className="auth-welcome-action">
          <div className="auth-trust-line">
            <ShieldCheck className="size-5" />
            <span>Private, secure, and built for your business</span>
          </div>
          <label className="auth-consent">
            <button
              type="button"
              role="checkbox"
              aria-checked={accepted}
              className={`auth-checkbox ${accepted ? "is-checked" : ""}`}
              onClick={() => {
                setAccepted((value) => !value);
                setError("");
              }}
            >
              {accepted && <Check className="size-4" />}
            </button>
            <span>
              I agree to the{" "}
              <button type="button" className="auth-link" onClick={() => setLocation("/terms")}>
                Terms and Conditions
              </button>
            </span>
          </label>
          {error && <div className="auth-error" role="alert">{error}</div>}
          <Button className="auth-primary-button" type="button" onClick={continueToPhone}>
            Continue
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </main>

      <footer className="auth-footer">
        <span>© {new Date().getFullYear()} Avarpus</span>
        <span>Business operations, made simple.</span>
      </footer>
    </div>
  );
}
