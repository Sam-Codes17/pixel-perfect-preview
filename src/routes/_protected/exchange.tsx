import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getExchangeQuote, executeExchange } from "@/lib/server-fns/exchange";
import { getWallet } from "@/lib/server-fns/wallet";
import { AppShell } from "@/components/rift/ui";
import { CURRENCY_LIST, CURRENCIES } from "@/lib/currencies";
import { formatAmount, generateIdempotencyKey } from "@/lib/format";
import { ArrowLeftRight, CheckCircle, AlertCircle, Clock } from "lucide-react";

export const Route = createFileRoute("/_protected/exchange")({
  head: () => ({
    meta: [
      { title: "Exchange — RIFT Bank" },
      { name: "description", content: "Swap RIFT ecosystem currencies at configured rates." },
    ],
  }),
  component: Exchange,
});

function Exchange() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [fromCur, setFromCur] = useState("RFM");
  const [toCur, setToCur] = useState("AUR");
  const [fromAmt, setFromAmt] = useState("");
  const [quote, setQuote] = useState<null | {
    id: string; from_amount: number; to_amount: number; rate: number; expires_at: string;
  }>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [idempKey] = useState(generateIdempotencyKey);

  const { data: wallet } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const quoteMutation = useMutation({
    mutationFn: () => getExchangeQuote({
      data: { token, from_currency_id: fromCur, to_currency_id: toCur, from_amount: parseInt(fromAmt, 10) },
    }),
    onSuccess: (q) => { setQuote(q); setError(""); },
    onError: (err) => setError(String(err)),
  });

  const executeMutation = useMutation({
    mutationFn: () => executeExchange({
      data: { token, quote_id: quote!.id, idempotency_key: idempKey },
    }),
    onSuccess: () => {
      setDone(true);
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err) => {
      const msg = String(err);
      if (msg.includes("QUOTE_EXPIRED")) setError("Quote expired. Please get a new quote.");
      else if (msg.includes("INSUFFICIENT_BALANCE")) setError("Insufficient balance.");
      else setError("Exchange failed. Please try again.");
      setQuote(null);
    },
  });

  const fromCurrency = CURRENCIES[fromCur as keyof typeof CURRENCIES];
  const toCurrency = CURRENCIES[toCur as keyof typeof CURRENCIES];
  const fromBalance = wallet?.balances?.find((b) => b.currency_id === fromCur)?.available_balance ?? 0;
  const rate = fromCurrency?.exchangeRates[toCur];
  const preview = rate ? Math.floor(parseInt(fromAmt || "0") * rate) : 0;

  const availableTo = CURRENCY_LIST.filter((c) => c.id !== fromCur);

  const swap = () => {
    const tmp = fromCur;
    setFromCur(toCur);
    setToCur(tmp);
    setFromAmt("");
    setQuote(null);
  };

  if (done) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
          <CheckCircle className="size-14 text-success" />
          <h2 className="text-xl font-medium text-success">Exchange complete!</h2>
          <p className="text-muted-foreground">
            {formatAmount(quote!.from_amount)} {fromCur} → {formatAmount(quote!.to_amount)} {toCur}
          </p>
          <button
            onClick={() => { setDone(false); setQuote(null); setFromAmt(""); }}
            className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
          >
            New exchange
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-7">
        <p className="label-mono mb-1">Exchange</p>
        <h1 className="text-2xl font-medium">Currency Exchange</h1>
        <p className="text-muted-foreground text-sm mt-2">Swap RIFT currencies at backend-configured rates. Quotes expire in 60 seconds.</p>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 panel p-6 grid gap-5">

          {/* From */}
          <label className="block">
            <span className="label-mono">Sell</span>
            <div className="grid grid-cols-4 gap-2 mt-1.5">
              {CURRENCY_LIST.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setFromCur(c.id); if (c.id === toCur) setToCur(CURRENCY_LIST.find((x) => x.id !== c.id)!.id); setQuote(null); }}
                  className={`p-2.5 rounded-lg border text-center text-xs transition-colors ${fromCur === c.id ? "border-primary bg-accent" : "border-border hover:border-muted-foreground"}`}
                  style={{ color: fromCur === c.id ? c.color : undefined }}
                >
                  <span className="font-bold block">{c.symbol}</span>
                  <span className="text-muted-foreground">{c.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
            <input
              className="w-full h-10 rounded-md bg-background border px-3 text-sm font-mono mt-2 focus:outline-none focus:ring-2 focus:ring-ring"
              type="number"
              min="1"
              max={fromBalance}
              value={fromAmt}
              onChange={(e) => { setFromAmt(e.target.value); setQuote(null); }}
              placeholder="Amount to sell"
            />
            <p className="text-xs text-muted-foreground mt-1">Available: {formatAmount(fromBalance)} {fromCur}</p>
          </label>

          {/* Swap button */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <button onClick={swap} className="size-9 rounded-full border grid place-items-center hover:bg-muted transition-colors">
              <ArrowLeftRight className="size-4" />
            </button>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* To */}
          <label className="block">
            <span className="label-mono">Receive</span>
            <div className="grid grid-cols-3 gap-2 mt-1.5">
              {availableTo.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setToCur(c.id); setQuote(null); }}
                  className={`p-2.5 rounded-lg border text-center text-xs transition-colors ${toCur === c.id ? "border-primary bg-accent" : "border-border hover:border-muted-foreground"}`}
                  style={{ color: toCur === c.id ? c.color : undefined }}
                >
                  <span className="font-bold block">{c.symbol}</span>
                  <span className="text-muted-foreground">{c.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
            <div className="h-10 rounded-md bg-muted border px-3 text-sm font-mono mt-2 flex items-center" style={{ color: toCurrency?.color }}>
              {quote ? formatAmount(quote.to_amount) : (preview > 0 ? `≈ ${formatAmount(preview)}` : "—")} {toCur}
            </div>
          </label>

          {/* Rate info */}
          <div className="flex justify-between text-xs text-muted-foreground px-1">
            <span>Rate: 1 {fromCur} = {rate?.toFixed(4)} {toCur}</span>
            {quote && (
              <span className="flex items-center gap-1 text-warning">
                <Clock className="size-3" />
                Quote expires in ~60s
              </span>
            )}
          </div>

          {error && <p className="text-destructive text-xs flex items-center gap-1"><AlertCircle className="size-3" />{error}</p>}

          {/* Actions */}
          {!quote ? (
            <button
              onClick={() => quoteMutation.mutate()}
              disabled={quoteMutation.isPending || !fromAmt || parseInt(fromAmt) <= 0 || parseInt(fromAmt) > fromBalance}
              className="h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {quoteMutation.isPending ? "Getting quote…" : "Get quote"}
            </button>
          ) : (
            <div className="grid gap-3">
              <div className="p-3 rounded-lg bg-muted text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">You sell</span><span className="font-mono" style={{ color: fromCurrency?.color }}>{formatAmount(quote.from_amount)} {fromCur}</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">You receive</span><span className="font-mono" style={{ color: toCurrency?.color }}>{formatAmount(quote.to_amount)} {toCur}</span></div>
                <div className="flex justify-between mt-1"><span className="text-muted-foreground">Rate</span><span className="font-mono">{quote.rate.toFixed(6)}</span></div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setQuote(null)} className="h-10 px-4 rounded-full border text-sm">Cancel</button>
                <button
                  onClick={() => executeMutation.mutate()}
                  disabled={executeMutation.isPending}
                  className="flex-1 h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {executeMutation.isPending ? <span className="auth-spinner" /> : <ArrowLeftRight className="size-4" />}
                  {executeMutation.isPending ? "Executing…" : "Confirm exchange"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Rates panel */}
        <div className="lg:col-span-2 panel p-5">
          <h2 className="text-sm mb-4">Exchange rates</h2>
          <div className="grid gap-2">
            {CURRENCY_LIST.map((from) =>
              CURRENCY_LIST.filter((to) => to.id !== from.id).map((to) => (
                <div key={`${from.id}-${to.id}`} className="flex justify-between text-xs py-1.5 border-b border-border last:border-0">
                  <span style={{ color: from.color }}>{from.symbol}</span>
                  <span className="text-muted-foreground">→</span>
                  <span style={{ color: to.color }}>{to.symbol}</span>
                  <span className="font-mono text-muted-foreground">{from.exchangeRates[to.id]?.toFixed(4)}</span>
                </div>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-4">Rates are configured on the backend. Quotes lock the rate for 60 seconds.</p>
        </div>
      </div>
    </AppShell>
  );
}
