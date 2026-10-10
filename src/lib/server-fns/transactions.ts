import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";

export const getTransactions = createServerFn({ method: "POST" })
  .validator((d: { token: string; limit?: number; offset?: number }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) return { transactions: [], total: 0 };

    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const { data: txns, count, error } = await supabaseAdmin
      .from("ledger_transactions")
      .select(`
        id, transaction_type, status, currency_id, amount, fee_amount,
        idempotency_key, reference, metadata, created_at, completed_at,
        sender_wallet_id, receiver_wallet_id,
        rift_operation_id, rift_status, risk_assessment, authorization_requirements, blockchain_evidence
      `, { count: "exact" })
      .or(`sender_wallet_id.eq.${wallet.id},receiver_wallet_id.eq.${wallet.id}`)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    // Enrich with counterparty names
    const enriched = await Promise.all((txns ?? []).map(async (txn) => {
      let counterparty = null;
      const counterWalletId = txn.sender_wallet_id === wallet.id
        ? txn.receiver_wallet_id
        : txn.sender_wallet_id;

      if (counterWalletId) {
        const { data: cWallet } = await supabaseAdmin
          .from("wallets")
          .select("user_id")
          .eq("id", counterWalletId)
          .single();

        if (cWallet) {
          const { data: cProfile } = await supabaseAdmin
            .from("profiles")
            .select("full_name")
            .eq("id", cWallet.user_id)
            .single();
          counterparty = cProfile?.full_name ?? "Unknown";
        }
      }

      return {
        ...txn,
        is_outgoing: txn.sender_wallet_id === wallet.id,
        counterparty,
        wallet_id: wallet.id,
      };
    }));

    return { transactions: enriched, total: count ?? 0 };
  });

export const getTransactionById = createServerFn({ method: "POST" })
  .validator((d: { token: string; transaction_id: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) throw new Error("Wallet not found");

    const { data: txn, error } = await supabaseAdmin
      .from("ledger_transactions")
      .select("*")
      .eq("id", data.transaction_id)
      .or(`sender_wallet_id.eq.${wallet.id},receiver_wallet_id.eq.${wallet.id}`)
      .single();

    if (error || !txn) throw new Error("Transaction not found or unauthorized");

    return { ...txn, wallet_id: wallet.id };
  });
