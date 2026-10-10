import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Eye, EyeOff, UserPlus, MailCheck, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create account — RIFT Bank" },
      { name: "description", content: "Join RIFT Bank and receive your initial wallet allocation." },
    ],
  }),
  component: Register,
});

function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "verify-email">("form");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message ?? "Sign-up failed. Please try again.");
      return;
    }

    // If no session it means email confirmation is required
    if (!data.session) {
      setStep("verify-email");
      return;
    }

    // Auto-confirmed (e.g. local dev) — redirect immediately
    window.location.href = "/";
  };

  const handleResend = async () => {
    setResending(true);
    setResent(false);
    const { error: resendErr } = await supabase.auth.resend({
      type: "signup",
      email,
    });
    setResending(false);
    if (!resendErr) setResent(true);
  };

  // ── Step: verify email ────────────────────────────────────────────────────
  if (step === "verify-email") {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-brand">
            <span className="brand-mark" />
            RIFT Bank
          </div>

          <div style={{ margin: "1.5rem auto 1rem", display: "flex", justifyContent: "center" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "rgba(212,168,67,0.12)", border: "2px solid rgba(212,168,67,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <MailCheck size={32} color="#d4a843" />
            </div>
          </div>

          <h1 className="auth-title" style={{ fontSize: "1.4rem" }}>Check your inbox</h1>
          <p className="auth-sub" style={{ marginBottom: "0.5rem" }}>
            We sent a verification link to
          </p>
          <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
            {email}
          </p>
          <p className="auth-sub" style={{ fontSize: "0.82rem", marginBottom: "1.75rem", lineHeight: 1.6 }}>
            Click the link in the email to confirm your account. Once confirmed, you can sign in and your RIFT wallet will be automatically set up.
          </p>

          {resent && (
            <p style={{ color: "#4ade80", fontSize: "0.82rem", marginBottom: "1rem" }}>
              ✓ Verification email resent successfully.
            </p>
          )}

          <button
            onClick={handleResend}
            disabled={resending}
            className="auth-btn"
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "var(--text-secondary)", marginBottom: "1rem" }}
          >
            {resending ? <span className="auth-spinner" /> : <RefreshCw className="size-4" />}
            {resending ? "Resending…" : "Resend verification email"}
          </button>

          <p className="auth-switch">
            Already confirmed?{" "}
            <Link to="/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Step: registration form ───────────────────────────────────────────────
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" />
          RIFT Bank
        </div>
        <h1 className="auth-title">Create account</h1>
        <p className="auth-sub">Join the RIFT financial ecosystem</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="auth-field">
            <span>Full name</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              required
              className="auth-input"
            />
          </label>

          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="auth-input"
            />
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input-wrap">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••  (min 8 characters)"
                required
                autoComplete="new-password"
                className="auth-input"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="auth-eye">
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={loading} className="auth-btn">
            {loading ? <span className="auth-spinner" /> : <UserPlus className="size-4" />}
            {loading ? "Creating account…" : "Create account"}
          </button>

          <p className="auth-note">
            You'll receive 10,000,000 RFM + 3 additional RIFT currencies automatically.
          </p>
        </form>

        <p className="auth-switch">
          Already have an account?{" "}
          <Link to="/login" className="auth-link">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
