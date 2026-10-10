import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";
import { CURRENCIES } from "@/lib/currencies";
import type { CurrencyId } from "@/lib/currencies";

export const getExchangeQuote = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    from_currency_id: string;
    to_currency_id: string;
    from_amount: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) throw new Error("Wallet not found");

    const fromCurrency = CURRENCIES[data.from_currency_id as CurrencyId];
    if (!fromCurrency) throw new Error("Invalid source currency");

    const rate = fromCurrency.exchangeRates[data.to_currency_id];
    if (rate === undefined) throw new Error("Exchange pair not supported");

    const fromAmount = Math.floor(data.from_amount);
    if (fromAmount <= 0) throw new Error("Amount must be positive");

    const toAmount = Math.floor(fromAmount * rate);
    if (toAmount <= 0) throw new Error("Resulting amount too small");

    const expiresAt = new Date(Date.now() + 60_000).toISOString(); // 60s validity

    const { data: quote, error } = await supabaseAdmin
      .from("currency_exchange_quotes")
      .insert({
        wallet_id:        wallet.id,
        from_currency_id: data.from_currency_id,
        to_currency_id:   data.to_currency_id,
        from_amount:      fromAmount,
        to_amount:        toAmount,
        rate,
        expires_at:       expiresAt,
      })
      .select()
      .single();

    if (error || !quote) throw new Error(`Failed to create quote: ${error?.message}`);

    return quote;
  });

export const executeExchange = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    quote_id: string;
    idempotency_key: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) throw new Error("Wallet not found");

    const { data: result, error } = await supabaseAdmin.rpc("execute_exchange", {
      p_wallet_id:       wallet.id,
      p_quote_id:        data.quote_id,
      p_idempotency_key: data.idempotency_key,
    });

    if (error) {
      if (error.message.includes("QUOTE_EXPIRED_OR_INVALID")) throw new Error("QUOTE_EXPIRED");
      if (error.message.includes("INSUFFICIENT_BALANCE")) throw new Error("INSUFFICIENT_BALANCE");
      throw new Error(`Exchange failed: ${error.message}`);
    }

    return result?.[0] ?? null;
  });
