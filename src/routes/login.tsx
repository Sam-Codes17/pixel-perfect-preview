import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Eye, EyeOff, LogIn } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — RIFT Bank" },
      { name: "description", content: "Sign in to your RIFT Bank account." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    navigate({ to: "/" });
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark" />
          RIFT Bank
        </div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to your RIFT financial ecosystem</p>

        <form onSubmit={handleSubmit} className="auth-form">
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
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="auth-input"
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="auth-eye">
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={loading} className="auth-btn">
            {loading ? <span className="auth-spinner" /> : <LogIn className="size-4" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-switch">
          New to RIFT Bank?{" "}
          <Link to="/register" className="auth-link">Create account</Link>
        </p>
      </div>
    </div>
  );
}
