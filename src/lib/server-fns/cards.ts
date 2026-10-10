import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";

export const getCards = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) return [];

    const { data: cards } = await supabaseAdmin
      .from("virtual_cards")
      .select("*")
      .eq("wallet_id", wallet.id)
      .neq("status", "TERMINATED")
      .order("created_at", { ascending: false });

    return cards ?? [];
  });

export const createCard = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    card_name: string;
    cardholder_name: string;
    currency_id?: string;
    spending_limit_daily?: number;
    spending_limit_monthly?: number;
  }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) throw new Error("Wallet not found");

    // Generate masked card number
    const last4 = Math.floor(1000 + Math.random() * 9000).toString();
    const masked_number = `**** **** **** ${last4}`;

    // Expiry: 3 years from now
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 3);

    const { data: card, error } = await supabaseAdmin
      .from("virtual_cards")
      .insert({
        wallet_id:              wallet.id,
        card_name:              data.card_name,
        masked_number,
        cardholder_name:        data.cardholder_name,
        expiry_month:           expiry.getMonth() + 1,
        expiry_year:            expiry.getFullYear(),
        currency_id:            data.currency_id ?? "RFM",
        spending_limit_daily:   data.spending_limit_daily ?? null,
        spending_limit_monthly: data.spending_limit_monthly ?? null,
      })
      .select()
      .single();

    if (error || !card) throw new Error(`Failed to create card: ${error?.message}`);

    return card;
  });

export const toggleCardFreeze = createServerFn({ method: "POST" })
  .validator((d: { token: string; card_id: string; freeze: boolean }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // Verify ownership
    const { data: card } = await supabaseAdmin
      .from("virtual_cards")
      .select("wallet_id, status")
      .eq("id", data.card_id)
      .single();

    if (!card) throw new Error("Card not found");
    if (card.status === "TERMINATED") throw new Error("Cannot modify a terminated card");

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("user_id")
      .eq("id", card.wallet_id)
      .single();

    if (!wallet || wallet.user_id !== user.id) throw new Error("Unauthorized");

    const { data: updated, error } = await supabaseAdmin
      .from("virtual_cards")
      .update({ status: data.freeze ? "FROZEN" : "ACTIVE", updated_at: new Date().toISOString() })
      .eq("id", data.card_id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return updated;
  });

export const terminateCard = createServerFn({ method: "POST" })
  .validator((d: { token: string; card_id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

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

    const { error } = await supabaseAdmin
      .from("virtual_cards")
      .update({ status: "TERMINATED", updated_at: new Date().toISOString() })
      .eq("id", data.card_id);

    if (error) throw new Error(error.message);
    return { success: true };
  });

export const getCardTransactions = createServerFn({ method: "POST" })
  .validator((d: { token: string; card_id?: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) return [];

    let query = supabaseAdmin
      .from("card_transactions")
      .select(`
        id, amount, currency_id, status, description, decline_reason, created_at,
        card_id,
        merchants (name, logo_emoji, category)
      `)
      .order("created_at", { ascending: false });

    if (data.card_id) {
      query = query.eq("card_id", data.card_id);
    } else {
      // Get all cards for this wallet
      const { data: cards } = await supabaseAdmin
        .from("virtual_cards")
        .select("id")
        .eq("wallet_id", wallet.id);

      const cardIds = (cards ?? []).map((c) => c.id);
      if (cardIds.length === 0) return [];
      query = query.in("card_id", cardIds);
    }

    const { data: txns } = await query.limit(100);
    return txns ?? [];
  });
