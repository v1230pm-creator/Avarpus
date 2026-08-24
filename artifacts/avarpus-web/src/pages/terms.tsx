import { ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

export function TermsPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="auth-screen">
      <header className="auth-topbar">
        <button
          type="button"
          aria-label="Back to welcome"
          className="auth-back-button"
          onClick={() => setLocation("/login")}
        >
          <ChevronLeft className="size-5" />
        </button>
        <span className="auth-wordmark">AVARPUS</span>
      </header>

      <main className="auth-terms-main">
        <div className="auth-terms-content">
          <p className="auth-eyebrow">Before you continue</p>
          <h1>Terms and Conditions</h1>
          <p className="auth-lede">
            A quick summary of the rules that keep Avarpus safe and useful for every shop.
          </p>
          <div className="auth-terms-list">
            <section>
              <h2>Use of your account</h2>
              <p>Keep your sign-in details private and use Avarpus only for your own authorised business operations.</p>
            </section>
            <section>
              <h2>Your business information</h2>
              <p>You are responsible for the accuracy of customer, repair, inventory, and financial information entered by your team.</p>
            </section>
            <section>
              <h2>Secure access</h2>
              <p>We use mobile verification and access controls to help protect your workspace. Never share verification codes with anyone.</p>
            </section>
          </div>
          <Button
            className="auth-primary-button auth-terms-button"
            type="button"
            onClick={() => {
              sessionStorage.setItem("avarpus_terms_accepted", "true");
              setLocation("/login?step=phone");
            }}
          >
            Agree &amp; Continue
          </Button>
        </div>
      </main>
    </div>
  );
}