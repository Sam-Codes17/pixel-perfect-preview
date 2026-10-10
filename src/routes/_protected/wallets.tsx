import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getWallet } from "@/lib/server-fns/wallet";
import { AppShell } from "@/components/rift/ui";
import { CURRENCY_LIST, CURRENCIES } from "@/lib/currencies";
import { formatAmount } from "@/lib/format";

export const Route = createFileRoute("/_protected/wallets")({
  head: () => ({
    meta: [
      { title: "Wallets — RIFT Bank" },
      { name: "description", content: "Your RIFT ecosystem currency balances." },
    ],
  }),
  component: Wallets,
});

function Wallets() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";

  const { data: wallet, isLoading } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  return (
    <AppShell>
      <div className="mb-7">
        <p className="label-mono mb-1">Wallets</p>
        <h1 className="text-2xl font-medium">My Wallets</h1>
        {wallet && (
          <p className="text-muted-foreground text-sm mt-2">
            Wallet ID: <span className="font-mono text-foreground">{wallet.wallet_number}</span>
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-12"><div className="auth-spinner large" /></div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {CURRENCY_LIST.map((cur) => {
            const bal = wallet?.balances?.find((b) => b.currency_id === cur.id);
            const available = bal?.available_balance ?? 0;
            const reserved = bal?.reserved_balance ?? 0;
            const total = available + reserved;
            const pct = total > 0 ? (available / total) * 100 : 100;

            return (
              <div
                key={cur.id}
                className="panel p-6"
                style={{ borderTop: `2px solid ${cur.color}` }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="label-mono">{cur.name}</p>
                    <p className="text-3xl font-semibold mt-1" style={{ color: cur.color }}>
                      {formatAmount(available)}
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">{cur.symbol}</p>
                  </div>
                  <div
                    className="size-12 rounded-full grid place-items-center text-lg font-bold"
                    style={{ background: cur.bgColor, color: cur.color }}
                  >
                    {cur.symbol[0]}
                  </div>
                </div>

                {/* Balance bar */}
                <div className="h-1.5 rounded-full bg-muted mb-3">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cur.color }} />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Available</p>
                    <p className="font-mono font-medium mt-0.5" style={{ color: cur.color }}>{formatAmount(available)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Reserved</p>
                    <p className="font-mono font-medium mt-0.5">{formatAmount(reserved)}</p>
                  </div>
                </div>

                {/* Exchange rates */}
                <div className="mt-4 pt-3 border-t border-border">
                  <p className="text-xs text-muted-foreground mb-2">Exchange rates from {cur.symbol}</p>
                  <div className="grid gap-1">
                    {Object.entries(cur.exchangeRates).map(([to, rate]) => {
                      const toCur = CURRENCIES[to as keyof typeof CURRENCIES];
                      return (
                        <div key={to} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">→ {toCur?.name}</span>
                          <span className="font-mono" style={{ color: toCur?.color }}>{Number(rate).toFixed(4)} {to}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
