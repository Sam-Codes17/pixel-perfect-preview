import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMerchants, purchaseWithCard, getMerchantOrders } from "@/lib/server-fns/merchants";
import { getCards } from "@/lib/server-fns/cards";
import { getWallet } from "@/lib/server-fns/wallet";
import { AppShell } from "@/components/rift/ui";
import { CURRENCIES } from "@/lib/currencies";
import { formatAmount, generateIdempotencyKey, formatRelative } from "@/lib/format";
import { ShoppingBag, CheckCircle, AlertCircle, X } from "lucide-react";

export const Route = createFileRoute("/_protected/merchants")({
  head: () => ({
    meta: [
      { title: "Marketplace — RIFT Bank" },
      { name: "description", content: "Shop at RIFT ecosystem merchants using your virtual cards." },
    ],
  }),
  component: Merchants,
});

// Demo products per merchant
const PRODUCTS: Record<string, Array<{ name: string; price: number; currency: string; desc: string }>> = {
  "rift-digital": [
    { name: "RIFT Pro License", price: 50000, currency: "RFM", desc: "Annual software license" },
    { name: "Design Pack AUR", price: 10000, currency: "AUR", desc: "Premium design assets" },
    { name: "Dev Tools NEX", price: 20000, currency: "NEX", desc: "Developer toolkit bundle" },
  ],
  "rift-cloud": [
    { name: "Cloud Starter", price: 100000, currency: "RFM", desc: "1TB cloud storage, 1 year" },
    { name: "Compute NEX Basic", price: 50000, currency: "NEX", desc: "Cloud compute instance" },
  ],
  "rift-market": [
    { name: "Premium Bundle RFM", price: 25000, currency: "RFM", desc: "Curated product bundle" },
    { name: "Market VELA Pass", price: 5000, currency: "VELA", desc: "Monthly marketplace pass" },
  ],
  "rift-travel": [
    { name: "City Escape RFM", price: 500000, currency: "RFM", desc: "Weekend getaway package" },
    { name: "Auric First Class", price: 200000, currency: "AUR", desc: "Premium flight upgrade" },
  ],
  "rift-subscriptions": [
    { name: "RIFT Premium", price: 9999, currency: "RFM", desc: "Monthly premium membership" },
    { name: "NEX Creator", price: 4999, currency: "NEX", desc: "Creator tools subscription" },
    { name: "VELA Insight", price: 2000, currency: "VELA", desc: "Financial insights plan" },
  ],
};

function Merchants() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [selectedMerchant, setSelectedMerchant] = useState<any>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedCard, setSelectedCard] = useState("");
  const [purchaseResult, setPurchaseResult] = useState<{ approved: boolean; reason?: string } | null>(null);

  const { data: merchants = [], isLoading } = useQuery({
    queryKey: ["merchants", token],
    queryFn: () => getMerchants({ data: { token } }),
    enabled: !!token,
  });

  const { data: cards = [] } = useQuery({
    queryKey: ["cards", token],
    queryFn: () => getCards({ data: { token } }),
    enabled: !!token,
  });

  const { data: wallet } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const { data: orders = [] } = useQuery({
    queryKey: ["orders", token],
    queryFn: () => getMerchantOrders({ data: { token } }),
    enabled: !!token,
  });

  const purchaseMutation = useMutation({
    mutationFn: () => purchaseWithCard({
      data: {
        token,
        card_id: selectedCard,
        merchant_id: selectedMerchant.id,
        amount: selectedProduct.price,
        currency_id: selectedProduct.currency,
        idempotency_key: generateIdempotencyKey(),
        description: `${selectedProduct.name} @ ${selectedMerchant.name}`,
      },
    }),
    onSuccess: (result) => {
      setPurchaseResult({ approved: result.approved, reason: result.decline_reason ?? undefined });
      if (result.approved) {
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["orders"] });
      }
    },
    onError: (err) => setPurchaseResult({ approved: false, reason: String(err) }),
  });

  const activeCards = (cards as any[]).filter((c) => c.status === "ACTIVE");

  return (
    <AppShell>
      <div className="mb-7">
        <p className="label-mono mb-1">Marketplace</p>
        <h1 className="text-2xl font-medium">RIFT Merchant Network</h1>
        <p className="text-muted-foreground text-sm mt-2">Internal RIFT ecosystem merchants — purchases use your virtual cards.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Merchant list */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="panel p-8 flex justify-center"><div className="auth-spinner" /></div>
          ) : (
            <div className="grid gap-3">
              {merchants.map((m: any) => (
                <div
                  key={m.id}
                  className={`panel p-5 cursor-pointer transition-all hover:border hover:border-primary/40 ${selectedMerchant?.id === m.id ? "border border-primary" : ""}`}
                  onClick={() => { setSelectedMerchant(m); setSelectedProduct(null); setPurchaseResult(null); }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{m.logo_emoji}</span>
                    <div>
                      <h3 className="font-medium">{m.name}</h3>
                      <p className="text-xs text-muted-foreground">{m.category} · Accepts: {m.accepted_currencies.join(", ")}</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.description}</p>

                  {selectedMerchant?.id === m.id && (
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="label-mono mb-2">Products</p>
                      <div className="grid gap-2">
                        {(PRODUCTS[m.slug] ?? []).map((p) => {
                          const cur = CURRENCIES[p.currency as keyof typeof CURRENCIES];
                          const bal = wallet?.balances?.find((b) => b.currency_id === p.currency)?.available_balance ?? 0;
                          const canAfford = bal >= p.price;
                          return (
                            <div
                              key={p.name}
                              onClick={(e) => { e.stopPropagation(); if (canAfford) { setSelectedProduct(p); setPurchaseResult(null); } }}
                              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${selectedProduct?.name === p.name ? "border-primary bg-accent" : "border-border"} ${canAfford ? "cursor-pointer hover:border-primary/50" : "opacity-40 cursor-not-allowed"}`}
                            >
                              <div>
                                <p className="text-sm font-medium">{p.name}</p>
                                <p className="text-xs text-muted-foreground">{p.desc}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-mono font-semibold" style={{ color: cur?.color }}>{formatAmount(p.price)}</p>
                                <p className="text-xs" style={{ color: cur?.color }}>{p.currency}</p>
                                {!canAfford && <p className="text-xs text-destructive">Insufficient balance</p>}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {selectedProduct && (
                        <div className="mt-4 grid gap-3">
                          <label className="block">
                            <span className="label-mono">Pay with card</span>
                            <select
                              className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
                              value={selectedCard}
                              onChange={(e) => { setSelectedCard(e.target.value); setPurchaseResult(null); }}
                            >
                              <option value="">Select a card…</option>
                              {activeCards.map((c: any) => (
                                <option key={c.id} value={c.id}>{c.card_name} — {c.masked_number} ({c.currency_id})</option>
                              ))}
                            </select>
                          </label>

                          {purchaseResult ? (
                            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${purchaseResult.approved ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                              {purchaseResult.approved ? <CheckCircle className="size-4 flex-shrink-0" /> : <AlertCircle className="size-4 flex-shrink-0" />}
                              {purchaseResult.approved ? "Purchase approved! Wallet debited." : `Declined: ${purchaseResult.reason}`}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); purchaseMutation.mutate(); }}
                              disabled={purchaseMutation.isPending || !selectedCard}
                              className="h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
                            >
                              {purchaseMutation.isPending ? <span className="auth-spinner" /> : <ShoppingBag className="size-4" />}
                              {purchaseMutation.isPending ? "Processing…" : `Buy for ${formatAmount(selectedProduct.price)} ${selectedProduct.currency}`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent orders */}
        <div className="panel p-5">
          <h2 className="text-sm mb-4">Recent Orders</h2>
          {(orders as any[]).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No orders yet.</p>
          ) : (
            <div className="grid gap-3">
              {(orders as any[]).slice(0, 8).map((o: any) => {
                const cur = CURRENCIES[o.currency_id as keyof typeof CURRENCIES];
                return (
                  <div key={o.id} className="flex items-start gap-2 pb-3 border-b border-border last:border-0">
                    <span className="text-lg">{o.merchants?.logo_emoji ?? "🏢"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{o.merchants?.name}</p>
                      <p className="text-xs text-muted-foreground">{formatRelative(o.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono" style={{ color: cur?.color }}>{formatAmount(o.amount)}</p>
                      <p className="text-xs" style={{ color: cur?.color }}>{o.currency_id}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
