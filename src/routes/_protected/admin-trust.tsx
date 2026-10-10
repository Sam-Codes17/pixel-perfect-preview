import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  adminGetTrustDashboard, adminResolveReview,
  adminSimulateFinding, adminRecalculateScore,
} from "@/lib/server-fns/trust-score";
import { AppShell } from "@/components/rift/ui";
import { formatRelative } from "@/lib/format";
import { ShieldCheck, RefreshCw, CheckCircle, X, AlertTriangle, Zap } from "lucide-react";

export const Route = createFileRoute("/_protected/admin-trust")({
  head: () => ({
    meta: [
      { title: "Trust Score Admin — RIFT Bank" },
      { name: "description", content: "RIFT Trust Score administration — restricted to admin role." },
    ],
  }),
  component: AdminTrust,
});

const FINDING_TYPES = [
  "REPLAY_ATTEMPT","BYPASS_ATTEMPT","TOKEN_MAPPING_VIOLATION",
  "SUSPICIOUS_BURST","AMOUNT_MISMATCH","FINALITY_VIOLATION",
  "INVALID_AUTH","SUSPICIOUS_WITHDRAWAL","UNMAPPED_TOKEN",
] as const;

function AdminTrust() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [simFindingType, setSimFindingType] = useState<string>("REPLAY_ATTEMPT");
  const [simSeverity, setSimSeverity] = useState<string>("HIGH");
  const [simConfidence, setSimConfidence] = useState<string>("CONFIRMED");
  const [simTargetUser, setSimTargetUser] = useState("");
  const [simNote, setSimNote] = useState("");
  const [simResult, setSimResult] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-trust", token],
    queryFn: () => adminGetTrustDashboard({ data: { token } }),
    enabled: !!token,
    retry: false,
  });

  const resolveMutation = useMutation({
    mutationFn: (p: { review_id: string; decision: "UPHELD" | "REVERSED" | "PARTIAL"; note: string }) =>
      adminResolveReview({ data: { token, ...p } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-trust"] }),
  });

  const simulateMutation = useMutation({
    mutationFn: () => adminSimulateFinding({
      data: {
        token,
        finding_type: simFindingType as any,
        severity: simSeverity as any,
        confidence: simConfidence as any,
        target_user_id: simTargetUser,
        note: simNote,
      },
    }),
    onSuccess: (r) => {
      setSimResult(JSON.stringify(r, null, 2));
      queryClient.invalidateQueries({ queryKey: ["admin-trust"] });
    },
  });

  if (isLoading) return <AppShell><div className="flex justify-center p-12"><div className="auth-spinner large" /></div></AppShell>;
  if (error) return (
    <AppShell>
      <div className="panel p-8 text-center text-destructive">
        <ShieldCheck className="size-8 mx-auto mb-3" />
        <p className="text-sm">Admin access required. Only users with the admin role can view this page.</p>
        <p className="text-xs text-muted-foreground mt-2">{String(error)}</p>
      </div>
    </AppShell>
  );

  const { dashboard = [], pendingReviews = [], recentAdjustments = [], policy } = data ?? {};

  const scoreDistribution = [
    { range: "900–1000", count: dashboard.filter((u: any) => u.current_score >= 900).length, label: "EXCELLENT" },
    { range: "800–899",  count: dashboard.filter((u: any) => u.current_score >= 800 && u.current_score < 900).length, label: "STRONG" },
    { range: "650–799",  count: dashboard.filter((u: any) => u.current_score >= 650 && u.current_score < 800).length, label: "ESTABLISHED" },
    { range: "450–649",  count: dashboard.filter((u: any) => u.current_score >= 450 && u.current_score < 650).length, label: "UNDER REVIEW" },
    { range: "0–449",    count: dashboard.filter((u: any) => u.current_score < 450).length, label: "SCRUTINY" },
  ];

  return (
    <AppShell>
      <div className="mb-7 flex items-center gap-3">
        <ShieldCheck className="size-6 text-primary" />
        <div>
          <p className="label-mono mb-1">Admin · Restricted</p>
          <h1 className="text-2xl font-medium">Trust Score Administration</h1>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">

        {/* Score distribution */}
        <div className="panel p-5">
          <h2 className="text-sm mb-4">Score Distribution ({dashboard.length} profiles)</h2>
          <div className="grid gap-2">
            {scoreDistribution.map((d) => (
              <div key={d.range} className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground w-16">{d.range}</span>
                <div className="flex-1 h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary"
                    style={{ width: `${dashboard.length ? (d.count / dashboard.length) * 100 : 0}%` }} />
                </div>
                <span className="w-6 text-right font-mono">{d.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* All profiles */}
        <div className="lg:col-span-2 panel p-5">
          <h2 className="text-sm mb-4">All Trust Profiles</h2>
          <div className="overflow-x-auto">
            <table className="transaction-table">
              <thead>
                <tr>{["User","Score","Status","Trend","Findings","Reviews","Last Updated"].map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {(dashboard as any[]).map((u) => (
                  <tr key={u.user_id}>
                    <td className="text-xs">{u.full_name}</td>
                    <td><span className="font-mono text-sm font-semibold">{u.current_score}</span></td>
                    <td><span className="type-pill text-xs">{u.status_label}</span></td>
                    <td><span className={`text-xs ${u.activity_trend === "IMPROVING" ? "text-success" : u.activity_trend === "DECLINING" ? "text-destructive" : "text-muted-foreground"}`}>{u.activity_trend}</span></td>
                    <td className="text-xs">{u.confirmed_findings} confirmed</td>
                    <td className="text-xs">{u.pending_reviews} pending</td>
                    <td className="text-xs text-muted-foreground">{formatRelative(u.last_calculated_at)}</td>
                  </tr>
                ))}
                {dashboard.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted-foreground py-6 text-xs">No trust profiles yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending reviews */}
        <div className="lg:col-span-2 panel p-5">
          <h2 className="text-sm mb-4">Pending Review Requests ({pendingReviews.length})</h2>
          {(pendingReviews as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No pending reviews.</p>
          ) : (
            <div className="grid gap-3">
              {(pendingReviews as any[]).map((r: any) => (
                <div key={r.id} className="p-4 rounded-lg border border-border grid gap-3">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{r.profiles?.full_name}</span>
                    <span className="text-muted-foreground">{formatRelative(r.created_at)}</span>
                  </div>
                  <p className="text-sm">"{r.user_statement}"</p>
                  {r.trust_score_adjustments && (
                    <div className="p-2 rounded bg-muted text-xs">
                      Adjustment: {r.trust_score_adjustments.score_delta > 0 ? "+" : ""}{r.trust_score_adjustments.score_delta} pts — {r.trust_score_adjustments.explanation}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {(["UPHELD","REVERSED","PARTIAL"] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => resolveMutation.mutate({ review_id: r.id, decision: d, note: `Admin decision: ${d}` })}
                        disabled={resolveMutation.isPending}
                        className={`h-8 px-3 rounded-full border text-xs transition-colors ${d === "REVERSED" ? "border-success text-success hover:bg-success/10" : d === "UPHELD" ? "border-destructive text-destructive hover:bg-destructive/10" : ""}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent adjustments */}
        <div className="panel p-5">
          <h2 className="text-sm mb-4">Recent Adjustments</h2>
          <div className="grid gap-2">
            {(recentAdjustments as any[]).slice(0, 10).map((a: any) => (
              <div key={a.id} className="flex items-center gap-2 text-xs pb-2 border-b border-border last:border-0">
                <span className={`font-mono font-semibold ${a.score_delta > 0 ? "text-success" : a.score_delta < 0 ? "text-destructive" : ""}`}>
                  {a.score_delta > 0 ? "+" : ""}{a.score_delta}
                </span>
                <span className="flex-1 truncate text-muted-foreground">{a.profiles?.full_name ?? "—"}</span>
                <span className="text-muted-foreground">{formatRelative(a.effective_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Simulate finding */}
        <div className="lg:col-span-2 panel p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="size-4 text-primary" />
            <h2 className="text-sm">Simulate RIFT Finding (Testing Only)</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-3 mb-3">
            <label className="block">
              <span className="label-mono">Finding type</span>
              <select className="w-full h-9 rounded-md bg-background border px-2 text-xs mt-1" value={simFindingType} onChange={(e) => setSimFindingType(e.target.value)}>
                {FINDING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-mono">Severity</span>
              <select className="w-full h-9 rounded-md bg-background border px-2 text-xs mt-1" value={simSeverity} onChange={(e) => setSimSeverity(e.target.value)}>
                {["INFO","LOW","MEDIUM","HIGH","CRITICAL"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label-mono">Confidence</span>
              <select className="w-full h-9 rounded-md bg-background border px-2 text-xs mt-1" value={simConfidence} onChange={(e) => setSimConfidence(e.target.value)}>
                {["LOW","MEDIUM","HIGH","CONFIRMED"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="grid md:grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="label-mono">Target user ID (UUID)</span>
              <input className="w-full h-9 rounded-md bg-background border px-3 text-xs font-mono mt-1" placeholder="auth user UUID" value={simTargetUser} onChange={(e) => setSimTargetUser(e.target.value)} />
            </label>
            <label className="block">
              <span className="label-mono">Note</span>
              <input className="w-full h-9 rounded-md bg-background border px-3 text-xs mt-1" placeholder="Test description" value={simNote} onChange={(e) => setSimNote(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-3 items-start">
            <button
              onClick={() => simulateMutation.mutate()}
              disabled={simulateMutation.isPending || !simTargetUser}
              className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground disabled:opacity-40 flex items-center gap-2"
            >
              {simulateMutation.isPending ? <span className="auth-spinner" /> : <Zap className="size-3" />}
              Simulate finding
            </button>
            {simResult && <button onClick={() => setSimResult(null)}><X className="size-4 text-muted-foreground" /></button>}
          </div>
          {simResult && (
            <pre className="mt-3 p-3 rounded-lg bg-muted text-xs font-mono overflow-x-auto">{simResult}</pre>
          )}
        </div>

        {/* Policy config */}
        <div className="panel p-5">
          <h2 className="text-sm mb-3">Active Policy (v{policy?.version})</h2>
          <pre className="text-xs font-mono text-muted-foreground overflow-x-auto">
            {JSON.stringify(policy?.config?.adjustments ?? {}, null, 2)}
          </pre>
        </div>
      </div>
    </AppShell>
  );
}
