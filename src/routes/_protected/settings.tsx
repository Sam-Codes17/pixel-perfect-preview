import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/rift/ui";
import { supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWallet } from "@/lib/server-fns/wallet";
import { CheckCircle, User, Lock, Shield } from "lucide-react";

export const Route = createFileRoute("/_protected/settings")({
  head: () => ({
    meta: [
      { title: "Settings — RIFT Bank" },
      { name: "description", content: "Manage your RIFT Bank account settings." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { session, user, signOut } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [newPassword, setNewPassword] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [pwError, setPwError] = useState("");

  const { data: wallet } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const changePassword = async () => {
    if (newPassword.length < 8) { setPwError("Password must be at least 8 characters"); return; }
    setPwStatus("saving");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { setPwStatus("error"); setPwError(error.message); }
    else { setPwStatus("done"); setNewPassword(""); }
  };

  return (
    <AppShell>
      <div className="mb-7">
        <p className="label-mono mb-1">Settings</p>
        <h1 className="text-2xl font-medium">Account Settings</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-4 max-w-2xl">
        {/* Profile */}
        <div className="panel p-5 grid gap-4">
          <div className="flex items-center gap-2 mb-1">
            <User className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Profile</h2>
          </div>
          <dl className="grid gap-2 text-sm">
            {[
              ["Name", wallet?.profile?.full_name ?? "—"],
              ["Email", user?.email ?? "—"],
              ["Wallet ID", wallet?.wallet_number ?? "—"],
              ["Role", wallet?.profile?.role ?? "user"],
              ["Member since", user?.created_at ? new Date(user.created_at).toLocaleDateString("en-IN") : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-border pb-2 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Security */}
        <div className="panel p-5 grid gap-4">
          <div className="flex items-center gap-2 mb-1">
            <Lock className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Security</h2>
          </div>

          <label className="block">
            <span className="label-mono">New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPwStatus("idle"); setPwError(""); }}
              placeholder="Min 8 characters"
              className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {pwError && <p className="text-destructive text-xs">{pwError}</p>}
          {pwStatus === "done" && (
            <div className="flex items-center gap-1.5 text-success text-xs">
              <CheckCircle className="size-3" /> Password updated
            </div>
          )}

          <button
            onClick={changePassword}
            disabled={pwStatus === "saving" || !newPassword}
            className="h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {pwStatus === "saving" ? "Updating…" : "Update password"}
          </button>

          <div className="pt-2 border-t border-border">
            <button
              onClick={signOut}
              className="w-full h-10 rounded-full border border-destructive/40 text-destructive text-sm hover:bg-destructive/10 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* RIFT Security info */}
        <div className="panel p-5 md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="size-4 text-primary" />
            <h2 className="text-sm font-medium">RIFT Security Integration</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            All financial transactions emit observable events to the RIFT security platform via the adapter layer.
            Transaction IDs, wallet references, asset types, amounts, and timestamps are recorded for monitoring.
            The security adapter is documented at <code className="text-xs bg-muted px-1 py-0.5 rounded">src/lib/server-fns/</code> and is 
            ready to connect to your RIFT security endpoint.
          </p>
          <div className="mt-3 p-3 rounded-lg bg-muted text-xs font-mono text-muted-foreground">
            Status: Adapter ready · Integration endpoint: not configured
          </div>
        </div>
      </div>
    </AppShell>
  );
}
