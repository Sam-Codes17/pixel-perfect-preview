import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { claimPendingTransfersForUser } from "@/lib/server-fns/transfer";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) {
      navigate({ to: "/login" });
    } else if (session?.access_token) {
      // Check and claim any pending transfers for this email
      claimPendingTransfersForUser({ data: { token: session.access_token } }).catch(() => {});
    }
  }, [session, loading, navigate]);

  if (loading) {
    return (
      <div className="auth-screen">
        <div className="flex flex-col items-center gap-4">
          <span className="brand-mark" style={{ transform: "scale(2)" }} />
          <div className="auth-spinner large" />
          <p className="text-muted-foreground text-sm">Loading RIFT Bank…</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return <Outlet />;
}
