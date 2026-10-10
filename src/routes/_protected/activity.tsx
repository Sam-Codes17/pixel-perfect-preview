import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getTransactions } from "@/lib/server-fns/transactions";
import { AppShell } from "@/components/rift/ui";
import { CURRENCIES } from "@/lib/currencies";
import { formatAmount, formatDate } from "@/lib/format";
import {
  TrendingUp, TrendingDown, ChevronDown, ChevronRight,
  ShieldCheck, ShieldAlert, KeyRound, ExternalLink, Hash, CheckCircle2
} from "lucide-react";

export const Route = createFileRoute("/_protected/activity")({
  head: () => ({
    meta: [
      { title: "Activity — RIFT Bank" },
      { name: "description", content: "Your complete RIFT Bank transaction history and blockchain verification records." },
    ],
  }),
  component: Activity,
});

function Activity() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [expandedTxnId, setExpandedTxnId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["transactions", token, 100],
    queryFn: () => getTransactions({ data: { token, limit: 100 } }),
    enabled: !!token,
  });

  const transactions = data?.transactions ?? [];

  const TYPE_LABELS: Record<string, string> = {
    INITIAL_ALLOCATION: "Allocation",
    TRANSFER: "Transfer",
    EXCHANGE_DEBIT: "Exchange (sell)",
    EXCHANGE_CREDIT: "Exchange (buy)",
    CARD_PURCHASE: "Card purchase",
    MERCHANT_CREDIT: "Merchant credit",
    REFUND: "Refund",
  };

  const toggleExpand = (id: string) => {
    setExpandedTxnId(expandedTxnId === id ? null : id);
  };

  return (
    <AppShell>
      <div className="mb-7">
        <p className="label-mono mb-1">Activity</p>
        <h1 className="text-2xl font-medium">Transaction History</h1>
        <p className="text-muted-foreground text-sm mt-2">
          {data?.total ?? 0} transactions total · Authoritative double-entry financial ledger
        </p>
      </div>

      <div className="panel p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center p-12">
            <div className="auth-spinner large" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No transactions yet. Send money or make a purchase to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="transaction-table w-full">
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  {["Type", "Counterparty", "Currency", "Amount", "Status", "Date"].map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const cur = CURRENCIES[t.currency_id as keyof typeof CURRENCIES];
                  const isOut = t.is_outgoing &&
                    !["INITIAL_ALLOCATION", "EXCHANGE_CREDIT"].includes(t.transaction_type);
                  const isIn = !t.is_outgoing ||
                    ["INITIAL_ALLOCATION", "EXCHANGE_CREDIT"].includes(t.transaction_type);
                  const isExpanded = expandedTxnId === t.id;
                  const hasRiftEvidence = !!(t.rift_operation_id || t.blockchain_evidence || t.metadata?.claim_token);

                  return (
                    <>
                      <tr
                        key={t.id}
                        onClick={() => toggleExpand(t.id)}
                        className="cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <td className="text-muted-foreground">
                          {hasRiftEvidence ? (
                            isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />
                          ) : null}
                        </td>
                        <td>
                          <span className={`type-pill ${isIn ? "green" : "red"}`}>
                            {TYPE_LABELS[t.transaction_type] ?? t.transaction_type}
                          </span>
                        </td>
                        <td>
                          <div className="transaction-name">
                            <span className="transaction-avatar" style={{ color: cur?.color, background: cur?.bgColor }}>
                              {t.counterparty ? t.counterparty[0] : (isIn ? "↓" : "↑")}
                            </span>
                            <span className="truncate max-w-[130px]">
                              {t.counterparty ?? (t.transaction_type === "INITIAL_ALLOCATION" ? "RIFT System" : "—")}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="text-xs font-mono font-semibold" style={{ color: cur?.color }}>
                            {t.currency_id}
                          </span>
                        </td>
                        <td>
                          <span className={`font-mono text-xs ${isIn ? "text-success" : "text-destructive"}`}>
                            {isIn ? "+" : "-"}{formatAmount(t.amount)}
                          </span>
                        </td>
                        <td>
                          <span className={`type-pill ${t.status === "COMPLETED" ? "green" : t.status === "FAILED" || t.status === "REJECTED" ? "red" : t.status === "HELD" ? "amber" : ""}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="text-muted-foreground text-xs whitespace-nowrap">
                          {formatDate(t.created_at)}
                        </td>
                      </tr>

                      {/* Expandable details row */}
                      {isExpanded && (
                        <tr className="bg-muted/30">
                          <td colSpan={7} className="p-4 border-t border-border">
                            <div className="grid md:grid-cols-2 gap-4 text-xs">
                              {/* Ledger & Reference details */}
                              <div className="space-y-1.5 font-mono">
                                <p className="font-semibold text-foreground font-sans">Transaction Identifiers</p>
                                <p className="text-muted-foreground">Internal Ledger ID: <span className="text-foreground break-all">{t.id}</span></p>
                                <p className="text-muted-foreground">Idempotency Key: <span className="text-foreground break-all">{t.idempotency_key}</span></p>
                                {t.reference && (
                                  <p className="text-muted-foreground">Reference / Note: <span className="text-foreground">{t.reference}</span></p>
                                )}
                                {t.metadata?.claim_token && (
                                  <p className="text-amber-400">Escrow Claim Token: <span className="break-all">{t.metadata.claim_token}</span></p>
                                )}
                              </div>

                              {/* RIFT Security & Forensic evidence */}
                              <div className="space-y-1.5 font-mono">
                                <p className="font-semibold text-foreground font-sans flex items-center gap-1.5">
                                  <ShieldCheck className="size-4 text-emerald-400" />
                                  RIFT Security & Forensics
                                </p>
                                {t.rift_operation_id ? (
                                  <>
                                    <p className="text-muted-foreground">RIFT Operation ID: <span className="text-primary break-all">{t.rift_operation_id}</span></p>
                                    {t.risk_assessment && (
                                      <p className="text-muted-foreground">
                                        Risk Assessment: <span className="text-emerald-400">{t.risk_assessment.risk_level} ({t.risk_assessment.risk_score})</span> · {t.risk_assessment.policy_matched}
                                      </p>
                                    )}
                                    {t.blockchain_evidence?.source && (
                                      <div className="mt-2 pt-2 border-t border-border space-y-1 text-[11px]">
                                        <p className="text-muted-foreground font-semibold">Local-Chain Execution Proof:</p>
                                        <p className="text-muted-foreground">Source L1 Tx: <span className="text-foreground break-all">{t.blockchain_evidence.source.tx_hash}</span> (Block {t.blockchain_evidence.source.block_number})</p>
                                        <p className="text-muted-foreground">Dest L2 Tx: <span className="text-foreground break-all">{t.blockchain_evidence.destination.tx_hash}</span> (Block {t.blockchain_evidence.destination.block_number})</p>
                                        <p className="text-cyan-400">Reconciliation: <span className="break-all">{t.blockchain_evidence.forensic_summary?.reconciliation_hash}</span></p>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <p className="text-muted-foreground">Standard internal ledger transfer (Atomic double-entry clearing).</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
