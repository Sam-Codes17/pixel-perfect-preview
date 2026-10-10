import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import { getWallet, provisionWallet } from "@/lib/server-fns/wallet";
import { getTransactions } from "@/lib/server-fns/transactions";
import { AppShell } from "@/components/rift/ui";
import { CURRENCIES, CURRENCY_LIST } from "@/lib/currencies";
import { formatAmount, formatCompact, formatRelative } from "@/lib/format";
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownLeft, Wallet, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/")({
  head: () => ({
    meta: [
      { title: "Dashboard — RIFT Bank" },
      { name: "description", content: "Your RIFT Bank financial overview." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const { data: txData } = useQuery({
    queryKey: ["transactions", token, 10],
    queryFn: () => getTransactions({ data: { token, limit: 10 } }),
    enabled: !!token,
  });

  const provisionMutation = useMutation({
    mutationFn: () => provisionWallet({ data: { token } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["wallet"] }),
  });

  const recentTxns = txData?.transactions ?? [];
  const totalRfm = wallet?.balances?.find((b) => b.currency_id === "RFM")?.available_balance ?? 0;

  if (walletLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="auth-spinner large" />
        </div>
      </AppShell>
    );
  }

  if (!wallet?.provisioned_at) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <Wallet className="size-12 text-primary opacity-60" />
          <h2 className="text-lg font-medium">Wallet not provisioned</h2>
          <p className="text-muted-foreground text-sm max-w-sm">
            Your wallet needs to be set up. Click below to receive your initial RIFT currency allocation.
          </p>
          <button
            onClick={() => provisionMutation.mutate()}
            disabled={provisionMutation.isPending}
            className="auth-btn"
            style={{ width: "auto", padding: "0 24px" }}
          >
            {provisionMutation.isPending ? <span className="auth-spinner" /> : <RefreshCw className="size-4" />}
            Set up wallet
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="dashboard-heading">
        <div>
          <h1>Dashboard</h1>
          <p>Welcome back, {wallet.profile?.full_name ?? "User"} · {wallet.wallet_number}</p>
        </div>
        <div className="metric-row">
          {wallet.balances.slice(0, 3).map((b) => {
            const cur = CURRENCIES[b.currency_id as keyof typeof CURRENCIES];
            return cur ? (
              <div className="metric" key={b.currency_id}>
                <span className="metric-icon" style={{ background: cur.bgColor, color: cur.color }}>
                  <span className="text-xs font-bold">{b.currency_id[0]}</span>
                </span>
                <div>
                  <div className="metric-value">{formatCompact(b.available_balance)}</div>
                  <div className="metric-label">{cur.name}</div>
                </div>
              </div>
            ) : null;
          })}
        </div>
      </div>

      {/* Currency balances */}
      <div className="currency-grid">
        {CURRENCY_LIST.map((cur) => {
          const bal = wallet.balances.find((b) => b.currency_id === cur.id);
          const amount = bal?.available_balance ?? 0;
          return (
            <div key={cur.id} className="currency-card" style={{ "--cur-color": cur.color, "--cur-bg": cur.bgColor, "--cur-glow": cur.glowColor } as React.CSSProperties}>
              <div className="currency-card-top">
                <span className="currency-symbol-badge">{cur.symbol}</span>
                <span className="currency-name">{cur.name}</span>
              </div>
              <div className="currency-amount">{formatCompact(amount)}</div>
              <div className="currency-full">{formatAmount(amount)} {cur.symbol}</div>
            </div>
          );
        })}
      </div>

      {/* Recent activity */}
      <section className="transactions-panel mt-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base">Recent Activity</h2>
          <Link to="/activity" className="text-xs text-primary hover:underline">View all</Link>
        </div>
        {recentTxns.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No transactions yet. Send money or make a purchase to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="transaction-table">
              <thead>
                <tr>{["Type", "Counterparty", "Currency", "Amount", "Status", "Time"].map((c) => (
                  <th key={c}>{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {recentTxns.map((t) => {
                  const cur = CURRENCIES[t.currency_id as keyof typeof CURRENCIES];
                  const isOut = t.is_outgoing;
                  return (
                    <tr key={t.id}>
                      <td>
                        <span className={`type-pill ${isOut ? "red" : "green"}`}>
                          {t.transaction_type.replace("_", " ")}
                        </span>
                      </td>
                      <td>
                        <div className="transaction-name">
                          <span className="transaction-avatar" style={{ color: cur?.color, background: cur?.bgColor }}>
                            {(t.counterparty ?? "S")[0]}
                          </span>
                          {t.counterparty ?? (t.transaction_type === "INITIAL_ALLOCATION" ? "RIFT System" : "—")}
                        </div>
                      </td>
                      <td><span className="text-xs font-mono" style={{ color: cur?.color }}>{t.currency_id}</span></td>
                      <td className={`font-mono text-xs ${isOut ? "text-destructive" : "text-success"}`}>
                        {isOut ? <TrendingDown className="inline size-3 mr-1" /> : <TrendingUp className="inline size-3 mr-1" />}
                        {formatAmount(t.amount)}
                      </td>
                      <td>
                        <span className={`type-pill ${t.status === "COMPLETED" ? "green" : t.status === "FAILED" ? "red" : ""}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="text-muted-foreground text-xs">{formatRelative(t.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
