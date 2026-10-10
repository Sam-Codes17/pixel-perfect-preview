import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";

export const getMerchants = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    await requireAuth(data.token);

    const { data: merchants, error } = await supabaseAdmin
      .from("merchants")
      .select("*")
      .eq("is_active", true)
      .order("name");

    if (error) throw new Error(error.message);
    return merchants ?? [];
  });

export const purchaseWithCard = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    card_id: string;
    merchant_id: string;
    amount: number;
    currency_id: string;
    idempotency_key: string;
    description?: string;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // Verify the card belongs to this user
    const { data: card } = await supabaseAdmin
      .from("virtual_cards")
      .select("wallet_id")
      .eq("id", data.card_id)
      .single();

    if (!card) throw new Error("Card not found");

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("user_id")
      .eq("id", card.wallet_id)
      .single();

    if (!wallet || wallet.user_id !== user.id) throw new Error("Unauthorized");

    const amount = Math.floor(data.amount);
    if (amount <= 0) throw new Error("Amount must be positive");

    const { data: result, error } = await supabaseAdmin.rpc("authorize_card_purchase", {
      p_card_id:         data.card_id,
      p_merchant_id:     data.merchant_id,
      p_amount:          amount,
      p_currency_id:     data.currency_id,
      p_idempotency_key: data.idempotency_key,
      p_description:     data.description ?? null,
    });

    if (error) throw new Error(`Purchase failed: ${error.message}`);

    const outcome = result?.[0];
    return {
      transaction_id: outcome?.transaction_id,
      approved: outcome?.approved ?? false,
      decline_reason: outcome?.decline_reason ?? null,
    };
  });

export const getMerchantOrders = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) return [];

    const { data: orders } = await supabaseAdmin
      .from("merchant_orders")
      .select(`
        id, amount, currency_id, status, items, created_at,
        merchants (name, logo_emoji, category),
        virtual_cards (card_name, masked_number)
      `)
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return orders ?? [];
  });
