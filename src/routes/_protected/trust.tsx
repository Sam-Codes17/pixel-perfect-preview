import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  getTrustProfile, getScoreAdjustments, getSecurityFindings,
  submitReviewRequest, getReviewRequests,
} from "@/lib/server-fns/trust-score";
import { AppShell } from "@/components/rift/ui";
import { formatDate, formatRelative } from "@/lib/format";
import {
  ShieldCheck, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, Clock, ChevronDown,
  ChevronRight, MessageSquare, Info, X,
} from "lucide-react";

export const Route = createFileRoute("/_protected/trust")({
  head: () => ({
    meta: [
      { title: "RIFT Trust Score — RIFT Bank" },
      { name: "description", content: "Your RIFT Trust Score profile, score history, and security findings." },
    ],
  }),
  component: TrustScore,
});

// ── Level styling ────────────────────────────────────────────────────────────
function getLevelStyle(tone: string) {
  switch (tone) {
    case "excellent":  return { color: "#22d3ee", bg: "rgba(34,211,238,0.1)",  border: "rgba(34,211,238,0.3)" };
    case "strong":     return { color: "#4ade80", bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.3)" };
    case "established":return { color: "#d4a843", bg: "rgba(212,168,67,0.1)", border: "rgba(212,168,67,0.3)" };
    case "review":     return { color: "#fb923c", bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.3)" };
    case "scrutiny":   return { color: "#f87171", bg: "rgba(248,113,113,0.1)",border: "rgba(248,113,113,0.3)" };
    case "restricted": return { color: "#ef4444", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.3)" };
    default:           return { color: "#9ca3af", bg: "rgba(156,163,175,0.1)",border: "rgba(156,163,175,0.3)" };
  }
}

function getToneFromLabel(label: string): string {
  if (label.includes("EXCELLENT"))  return "excellent";
  if (label.includes("STRONG"))     return "strong";
  if (label.includes("ESTABLISHED"))return "established";
  if (label.includes("UNDER"))      return "review";
  if (label.includes("ELEVATED"))   return "scrutiny";
  if (label.includes("RESTRICTED")) return "restricted";
  return "muted";
}

function ScoreArc({ score }: { score: number }) {
  const pct = score / 1000;
  const r = 88;
  const cx = 110;
  const cy = 110;
  const startAngle = -220;
  const sweepAngle = 260;

  const toXY = (angleDeg: number, radius: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const arcPath = (startDeg: number, endDeg: number, r: number) => {
    const s = toXY(startDeg, r);
    const e = toXY(endDeg, r);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const endAngle = startAngle + sweepAngle * pct;
  const tone = score >= 900 ? "#22d3ee" : score >= 800 ? "#4ade80" : score >= 650 ? "#d4a843" : score >= 450 ? "#fb923c" : score >= 250 ? "#f87171" : "#ef4444";

  return (
    <svg viewBox="0 0 220 190" className="trust-arc" aria-hidden>
      {/* Track */}
      <path d={arcPath(startAngle, startAngle + sweepAngle, r)} stroke="var(--border)" strokeWidth={14} fill="none" strokeLinecap="round" />
      {/* Fill */}
      {pct > 0 && (
        <path d={arcPath(startAngle, endAngle, r)} stroke={tone} strokeWidth={14} fill="none" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${tone}80)` }} />
      )}
      {/* Score text */}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize={36} fontWeight={600} fill="var(--foreground)">{score}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">/ 1000</text>
    </svg>
  );
}

function ScoreHistoryChart({ adjustments }: { adjustments: any[] }) {
  if (!adjustments || adjustments.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Not enough history to display a chart yet.
      </div>
    );
  }

  // Build cumulative score timeline (oldest first)
  const points = [...adjustments].reverse().map((a) => ({
    score: a.resulting_score,
    date: a.effective_at,
    delta: a.score_delta,
  }));

  const min = Math.max(0, Math.min(...points.map((p) => p.score)) - 50);
  const max = Math.min(1000, Math.max(...points.map((p) => p.score)) + 50);
  const range = max - min || 1;
  const W = 100; const H = 60;
  const toX = (i: number) => (i / (points.length - 1)) * W;
  const toY = (s: number) => H - ((s - min) / range) * H;

  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.score).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 80 }}>
      <defs>
        <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L ${toX(points.length - 1).toFixed(1)} ${H} L 0 ${H} Z`} fill="url(#scoreGrad)" />
      <path d={d} stroke="var(--primary)" strokeWidth={1.5} fill="none" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={toX(i)} cy={toY(p.score)} r={2}
          fill={p.delta > 0 ? "var(--success)" : p.delta < 0 ? "var(--destructive)" : "var(--muted-foreground)"}
        />
      ))}
    </svg>
  );
}

function AdjustmentRow({ adj, onDispute }: { adj: any; onDispute: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const isPositive = adj.score_delta > 0;
  const isZero = adj.score_delta === 0;

  const CATEGORY_LABEL: Record<string, string> = {
    TRANSACTION_RELIABILITY: "Transaction",
    SECURITY_COMPLIANCE:     "Security",
    SUSPICIOUS_ACTIVITY:     "Suspicious Activity",
    ACCOUNT_SECURITY:        "Account Security",
    HISTORICAL_CONSISTENCY:  "History",
    REVERSAL:                "Reversal",
    RECALCULATION:           "Recalculation",
    INITIAL:                 "Initial",
  };

  return (
    <div className={`trust-adj-row ${adj.is_reversed ? "opacity-50" : ""}`}>
      <button onClick={() => setOpen(!open)} className="trust-adj-header">
        <span className={`trust-adj-delta ${isPositive ? "positive" : isZero ? "neutral" : "negative"}`}>
          {isPositive ? <TrendingUp className="size-3" /> : isZero ? <Minus className="size-3" /> : <TrendingDown className="size-3" />}
          {isPositive ? "+" : ""}{adj.score_delta}
        </span>
        <span className="flex-1 text-left">
          <span className="type-pill text-xs mr-2">{CATEGORY_LABEL[adj.category] ?? adj.category}</span>
          {adj.is_provisional && <span className="type-pill text-xs" style={{ background: "rgba(251,146,60,0.12)", color: "#fb923c" }}>Provisional</span>}
          {adj.is_reversed && <span className="type-pill text-xs ml-1">Reversed</span>}
        </span>
        <span className="text-xs text-muted-foreground mr-2">{formatRelative(adj.effective_at)}</span>
        <span className="text-xs font-mono text-muted-foreground mr-3">{adj.resulting_score}</span>
        {open ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
      </button>

      {open && (
        <div className="trust-adj-body">
          <p className="text-sm">{adj.explanation}</p>
          <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-muted-foreground">
            <span>Score: {adj.previous_score} → {adj.resulting_score}</span>
            {adj.rule_reference && <span>Rule: <code className="bg-muted px-1 rounded">{adj.rule_reference}</code></span>}
            <span>Policy v{adj.policy_version}</span>
            <span>{formatDate(adj.effective_at)}</span>
          </div>
          {!adj.is_reversed && !adj.reversal_of && adj.category !== "INITIAL" && adj.score_delta < 0 && (
            <button
              onClick={() => onDispute(adj.id)}
              className="mt-3 flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <MessageSquare className="size-3" /> Dispute this adjustment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: any }) {
  const [open, setOpen] = useState(false);
  const SEV_COLOR: Record<string, string> = {
    INFO: "var(--muted-foreground)", LOW: "var(--success)",
    MEDIUM: "#fb923c", HIGH: "var(--destructive)", CRITICAL: "#ef4444",
  };
  const STATUS_TONE: Record<string, string> = {
    OPEN: "", UNDER_REVIEW: "blue", CONFIRMED: "red",
    DISMISSED: "green", FALSE_POSITIVE: "green", CORRECTED: "green",
  };

  return (
    <div className="trust-adj-row">
      <button onClick={() => setOpen(!open)} className="trust-adj-header">
        <AlertTriangle className="size-3 flex-shrink-0" style={{ color: SEV_COLOR[finding.severity] }} />
        <span className="flex-1 text-left text-sm">{finding.rule_name ?? finding.finding_type}</span>
        <span className={`type-pill text-xs mr-2 ${STATUS_TONE[finding.status]}`}>{finding.status}</span>
        <span className="text-xs text-muted-foreground">{formatRelative(finding.finding_timestamp)}</span>
        {open ? <ChevronDown className="size-3 flex-shrink-0" /> : <ChevronRight className="size-3 flex-shrink-0" />}
      </button>
      {open && (
        <div className="trust-adj-body text-xs text-muted-foreground grid gap-1.5">
          <div className="grid grid-cols-2 gap-2">
            <span>Type: {finding.finding_type}</span>
            <span>Severity: <span style={{ color: SEV_COLOR[finding.severity] }}>{finding.severity}</span></span>
            <span>Confidence: {finding.confidence}</span>
            <span>Role: {finding.attribution_role}</span>
          </div>
          {finding.rule_id && <span>Rule ID: <code className="bg-muted px-1 rounded">{finding.rule_id}</code></span>}
          {finding.resolution_note && <p className="text-foreground">Resolution: {finding.resolution_note}</p>}
          <p>Ingested: {formatDate(finding.ingested_at)}</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
function TrustScore() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [disputeAdjId, setDisputeAdjId] = useState<string | null>(null);
  const [disputeStatement, setDisputeStatement] = useState("");
  const [disputeError, setDisputeError] = useState("");
  const [activeTab, setActiveTab] = useState<"history" | "findings" | "reviews">("history");

  const { data: trustData, isLoading } = useQuery({
    queryKey: ["trust-profile", token],
    queryFn: () => getTrustProfile({ data: { token } }),
    enabled: !!token,
  });

  const { data: adjustments = [] } = useQuery({
    queryKey: ["score-adjustments", token],
    queryFn: () => getScoreAdjustments({ data: { token, limit: 60 } }),
    enabled: !!token,
  });

  const { data: findings = [] } = useQuery({
    queryKey: ["security-findings", token],
    queryFn: () => getSecurityFindings({ data: { token } }),
    enabled: !!token,
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ["review-requests", token],
    queryFn: () => getReviewRequests({ data: { token } }),
    enabled: !!token,
  });

  const disputeMutation = useMutation({
    mutationFn: () => submitReviewRequest({
      data: { token, adjustment_id: disputeAdjId!, user_statement: disputeStatement },
    }),
    onSuccess: () => {
      setDisputeAdjId(null);
      setDisputeStatement("");
      queryClient.invalidateQueries({ queryKey: ["review-requests"] });
    },
    onError: (err) => setDisputeError(String(err)),
  });

  const profile = trustData?.profile;
  const policy = trustData?.policy;
  const score = profile?.current_score ?? 700;
  const label = profile?.status_label ?? "LIMITED HISTORY";
  const tone = getToneFromLabel(label);
  const levelStyle = getLevelStyle(tone);
  const trend = profile?.activity_trend ?? "STABLE";
  const levels = (policy?.config?.levels ?? []) as any[];

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="auth-spinner large" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-7 flex items-start justify-between">
        <div>
          <p className="label-mono mb-1">Trust</p>
          <h1 className="text-2xl font-medium">RIFT Trust Score</h1>
          <p className="text-muted-foreground text-sm mt-2 max-w-xl">
            An internal RIFT ecosystem metric of your recorded compliance history. Not a credit score,
            proof of identity, or determination of character.
          </p>
        </div>
        <Link to="/settings" className="label-mono hover:text-foreground transition-colors">Settings</Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">

        {/* Score card */}
        <div className="lg:col-span-1">
          <div className="panel p-6 flex flex-col items-center gap-3"
            style={{ borderTop: `3px solid ${levelStyle.color}`, boxShadow: `0 0 30px ${levelStyle.border}` }}>

            <ScoreArc score={score} />

            <div className="text-center">
              <div className="trust-level-badge" style={{ color: levelStyle.color, background: levelStyle.bg, border: `1px solid ${levelStyle.border}` }}>
                {label}
              </div>
              <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-muted-foreground">
                {trend === "IMPROVING" ? <TrendingUp className="size-3 text-success" /> :
                 trend === "DECLINING" ? <TrendingDown className="size-3 text-destructive" /> :
                 <Minus className="size-3" />}
                Recent activity: <span className={trend === "IMPROVING" ? "text-success" : trend === "DECLINING" ? "text-destructive" : ""}>{trend}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Last recalculated: {profile?.last_calculated_at ? formatRelative(profile.last_calculated_at) : "—"}
              </p>
            </div>

            {/* Score breakdown mini */}
            <div className="w-full pt-3 border-t border-border">
              <p className="label-mono mb-2">Profile</p>
              <dl className="grid gap-1.5 text-xs">
                {[
                  ["Policy version", `v${profile?.policy_version ?? 1}`],
                  ["Score version", `#${profile?.score_version ?? 0}`],
                  ["Total adjustments", profile?.total_adjustments ?? 0],
                  ["New profile", profile?.is_new_profile ? "Yes — Limited History" : "No"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Level thresholds */}
            <div className="w-full pt-3 border-t border-border">
              <p className="label-mono mb-2">Thresholds (current policy)</p>
              <div className="grid gap-1">
                {levels.map((lv: any) => {
                  const lStyle = getLevelStyle(lv.tone);
                  const isCurrent = score >= lv.min && score <= lv.max;
                  return (
                    <div key={lv.label} className={`flex justify-between text-xs py-1 px-2 rounded ${isCurrent ? "font-semibold" : ""}`}
                      style={isCurrent ? { background: lStyle.bg } : {}}>
                      <span style={isCurrent ? { color: lStyle.color } : { color: "var(--muted-foreground)" }}>{lv.label}</span>
                      <span className="font-mono text-muted-foreground">{lv.min}–{lv.max}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Integration status */}
          <div className="panel p-4 mt-3">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="size-4 text-primary" />
              <p className="text-xs font-medium">RIFT Security Integration</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Score adjustments from transaction events are active via Postgres triggers.
              External RIFT API integration requires endpoint configuration.
            </p>
            <div className="mt-2 p-2 rounded bg-muted text-xs font-mono text-muted-foreground">
              Triggers: Active · External API: Not configured
            </div>
          </div>
        </div>

        {/* Right panel: tabs */}
        <div className="lg:col-span-2">
          {/* Score history chart */}
          <div className="panel p-5 mb-4">
            <p className="label-mono mb-3">Score History</p>
            <ScoreHistoryChart adjustments={adjustments as any[]} />
          </div>

          {/* Tabs */}
          <div className="panel overflow-hidden">
            <div className="flex border-b border-border">
              {([
                ["history",  `Adjustments (${(adjustments as any[]).length})`],
                ["findings", `Findings (${(findings as any[]).length})`],
                ["reviews",  `Reviews (${(reviews as any[]).length})`],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-3 text-xs font-medium border-b-2 transition-colors ${activeTab === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-4">
              {/* Adjustments tab */}
              {activeTab === "history" && (
                <div>
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted mb-3">
                    <Info className="size-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Every change to your score is recorded here with a documented reason.
                      Provisional adjustments are applied during investigations and may be reversed.
                    </p>
                  </div>
                  {(adjustments as any[]).length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No adjustments recorded yet.</div>
                  ) : (
                    <div className="grid gap-2">
                      {(adjustments as any[]).map((adj: any) => (
                        <AdjustmentRow key={adj.id} adj={adj} onDispute={setDisputeAdjId} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Findings tab */}
              {activeTab === "findings" && (
                <div>
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted mb-3">
                    <Info className="size-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground">
                      Security findings from the RIFT rule engine attributed to your account.
                      A finding is not a proven violation — preliminary findings are provisional.
                    </p>
                  </div>
                  {(findings as any[]).length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      <CheckCircle className="size-8 text-success mx-auto mb-2" />
                      No security findings recorded against this account.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {(findings as any[]).map((f: any) => <FindingRow key={f.id} finding={f} />)}
                    </div>
                  )}
                </div>
              )}

              {/* Reviews tab */}
              {activeTab === "reviews" && (
                <div>
                  {(reviews as any[]).length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      No review requests submitted. Use "Dispute this adjustment" on any negative adjustment.
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      {(reviews as any[]).map((r: any) => (
                        <div key={r.id} className="p-3 rounded-lg border border-border text-xs grid gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className={`type-pill ${r.status === "RESOLVED" ? "green" : r.status === "DISMISSED" ? "red" : ""}`}>
                              {r.status}
                            </span>
                            <span className="text-muted-foreground">{formatRelative(r.created_at)}</span>
                          </div>
                          <p className="text-sm">"{r.user_statement}"</p>
                          {r.reviewer_note && (
                            <p className="text-muted-foreground">Decision: {r.reviewer_decision} — {r.reviewer_note}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Dispute modal */}
      {disputeAdjId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel p-6 w-full max-w-md grid gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">Dispute Adjustment</h2>
              <button onClick={() => { setDisputeAdjId(null); setDisputeError(""); }}><X className="size-4" /></button>
            </div>
            <p className="text-sm text-muted-foreground">
              Describe why you believe this adjustment is incorrect. A reviewer will examine the finding and may reverse it if appropriate.
              This does not directly modify your score.
            </p>
            <textarea
              className="w-full rounded-md bg-background border px-3 py-2 text-sm min-h-[100px] focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="Explain why this finding is incorrect…"
              value={disputeStatement}
              onChange={(e) => setDisputeStatement(e.target.value)}
            />
            {disputeError && <p className="text-destructive text-xs">{disputeError}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setDisputeAdjId(null); setDisputeError(""); }} className="h-9 px-4 rounded-full border text-sm">Cancel</button>
              <button
                onClick={() => disputeMutation.mutate()}
                disabled={disputeMutation.isPending || !disputeStatement.trim()}
                className="flex-1 h-9 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {disputeMutation.isPending ? "Submitting…" : "Submit review request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
