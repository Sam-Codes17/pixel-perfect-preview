import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getCards, createCard, toggleCardFreeze, terminateCard } from "@/lib/server-fns/cards";
import { getWallet } from "@/lib/server-fns/wallet";
import { AppShell } from "@/components/rift/ui";
import { CURRENCIES, CURRENCY_LIST } from "@/lib/currencies";
import { formatAmount } from "@/lib/format";
import { CreditCard, Plus, Lock, Unlock, Trash2, CheckCircle, X } from "lucide-react";

export const Route = createFileRoute("/_protected/cards")({
  head: () => ({
    meta: [
      { title: "Virtual Cards — RIFT Bank" },
      { name: "description", content: "RIFT Network virtual debit cards for ecosystem purchases." },
    ],
  }),
  component: Cards,
});

function Cards() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [cardName, setCardName] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("RFM");
  const [dailyLimit, setDailyLimit] = useState("");
  const [createError, setCreateError] = useState("");

  const { data: wallet } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ["cards", token],
    queryFn: () => getCards({ data: { token } }),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: () => createCard({
      data: {
        token,
        card_name: cardName,
        cardholder_name: cardholderName,
        currency_id: selectedCurrency,
        ...(dailyLimit ? { spending_limit_daily: parseInt(dailyLimit, 10) } : {}),
      },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setShowNew(false);
      setCardName("");
      setCardholderName("");
      setDailyLimit("");
      setCreateError("");
    },
    onError: (err) => setCreateError(String(err)),
  });

  const freezeMutation = useMutation({
    mutationFn: ({ card_id, freeze }: { card_id: string; freeze: boolean }) =>
      toggleCardFreeze({ data: { token, card_id, freeze } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cards"] }),
  });

  const terminateMutation = useMutation({
    mutationFn: (card_id: string) => terminateCard({ data: { token, card_id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cards"] }),
  });

  return (
    <AppShell>
      <div className="mb-7 flex items-start justify-between">
        <div>
          <p className="label-mono mb-1">Cards</p>
          <h1 className="text-2xl font-medium">Virtual Cards</h1>
          <p className="text-muted-foreground text-sm mt-2">RIFT Network cards for ecosystem purchases only. Not Visa or Mastercard.</p>
        </div>
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-2 h-9 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" /> New card
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Card list */}
        <div className="lg:col-span-2 grid gap-4">
          {isLoading && <div className="panel p-8 flex justify-center"><div className="auth-spinner" /></div>}

          {!isLoading && cards.length === 0 && !showNew && (
            <div className="panel p-12 text-center text-muted-foreground">
              <CreditCard className="size-12 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No cards yet. Create your first virtual card.</p>
            </div>
          )}

          {cards.map((card: any) => {
            const cur = CURRENCIES[card.currency_id as keyof typeof CURRENCIES];
            const isFrozen = card.status === "FROZEN";
            const balance = wallet?.balances?.find((b) => b.currency_id === card.currency_id)?.available_balance ?? 0;

            return (
              <div key={card.id} className={`panel p-5 ${isFrozen ? "opacity-70" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  {/* Card visual */}
                  <div className={`payment-card flex-shrink-0 w-48 ${card.currency_id === "NEX" ? "purple" : "gold"}`}>
                    <div>
                      <p className="card-title">{card.card_name}</p>
                      <p className="text-xs mt-0.5">{card.masked_number}</p>
                    </div>
                    <div className="card-footer">
                      <span>{card.cardholder_name}</span>
                      <span>{String(card.expiry_month).padStart(2,"0")}/{card.expiry_year}</span>
                    </div>
                  </div>

                  {/* Card details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`type-pill ${isFrozen ? "" : "green"}`}>
                        {card.status}
                      </span>
                      <span className="text-xs text-muted-foreground" style={{ color: cur?.color }}>
                        {cur?.name} ({card.currency_id})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Balance: {formatAmount(balance)} {card.currency_id}</p>
                    {card.spending_limit_daily && (
                      <p className="text-xs text-muted-foreground mt-0.5">Daily limit: {formatAmount(card.spending_limit_daily)} {card.currency_id}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">Online: {card.online_purchases_enabled ? "Enabled" : "Disabled"}</p>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => freezeMutation.mutate({ card_id: card.id, freeze: !isFrozen })}
                        disabled={freezeMutation.isPending}
                        className={`flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs transition-colors ${isFrozen ? "border-primary text-primary hover:bg-accent" : "hover:bg-muted"}`}
                      >
                        {isFrozen ? <Unlock className="size-3" /> : <Lock className="size-3" />}
                        {isFrozen ? "Unfreeze" : "Freeze"}
                      </button>
                      <button
                        onClick={() => { if (confirm("Permanently terminate this card?")) terminateMutation.mutate(card.id); }}
                        disabled={terminateMutation.isPending}
                        className="flex items-center gap-1.5 h-7 px-3 rounded-full border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="size-3" /> Terminate
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* New card form */}
        <div>
          {showNew && (
            <div className="panel p-5 grid gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">New virtual card</h2>
                <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>

              <label className="block">
                <span className="label-mono">Card nickname</span>
                <input className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring" placeholder="e.g. Gaming, Shopping" value={cardName} onChange={(e) => setCardName(e.target.value)} />
              </label>

              <label className="block">
                <span className="label-mono">Cardholder name</span>
                <input className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring" placeholder="Your full name" value={cardholderName} onChange={(e) => setCardholderName(e.target.value)} />
              </label>

              <label className="block">
                <span className="label-mono">Currency</span>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {CURRENCY_LIST.map((c) => (
                    <button key={c.id} onClick={() => setSelectedCurrency(c.id)}
                      className={`p-2 rounded-lg border text-xs text-center transition-colors ${selectedCurrency === c.id ? "border-primary bg-accent" : "border-border"}`}
                      style={{ color: selectedCurrency === c.id ? c.color : undefined }}>
                      {c.symbol}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block">
                <span className="label-mono">Daily limit (optional)</span>
                <input className="w-full h-10 rounded-md bg-background border px-3 text-sm font-mono mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring" type="number" placeholder="0 = unlimited" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
              </label>

              {createError && <p className="text-destructive text-xs">{createError}</p>}

              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !cardName || !cardholderName}
                className="h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? <span className="auth-spinner" /> : <CheckCircle className="size-4" />}
                {createMutation.isPending ? "Creating…" : "Create card"}
              </button>
            </div>
          )}

          <div className="panel p-5 mt-4">
            <h2 className="text-sm mb-3">Card policies</h2>
            <ul className="grid gap-2 text-xs text-muted-foreground">
              <li>• RIFT Network only — not external payment networks</li>
              <li>• Freeze pauses purchases instantly via backend check</li>
              <li>• Termination is permanent and cannot be reversed</li>
              <li>• Daily limits enforced server-side on each purchase</li>
              <li>• Declined purchases never debit your wallet</li>
            </ul>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
