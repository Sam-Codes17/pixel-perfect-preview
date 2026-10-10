import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";

/** Provision wallet + initial currency allocation for the authenticated user. Idempotent. */
export const provisionWallet = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: result, error } = await supabaseAdmin.rpc("provision_wallet", {
      p_user_id: user.id,
    });

    if (error) throw new Error(`PROVISION_FAILED: ${error.message}`);
    const row = result?.[0];
    return row
      ? {
          wallet_id: row.out_wallet_id ?? row.wallet_id,
          wallet_number: row.out_wallet_number ?? row.wallet_number,
        }
      : null;
  });

/** Get the authenticated user's wallet and all currency balances. */
export const getWallet = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    const { data: wallet, error: wErr } = await supabaseAdmin
      .from("wallets")
      .select("id, wallet_number, is_active, provisioned_at, created_at")
      .eq("user_id", user.id)
      .single();

    if (wErr || !wallet) return null;

    const { data: balances } = await supabaseAdmin
      .from("wallet_balances")
      .select("currency_id, available_balance, reserved_balance, updated_at")
      .eq("wallet_id", wallet.id);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, role")
      .eq("id", user.id)
      .single();

    return {
      ...wallet,
      balances: balances ?? [],
      profile: profile ?? { full_name: user.email?.split("@")[0] ?? "User", role: "user" },
      email: user.email,
    };
  });

/** Find a user's wallet by their email address (for sending money). */
export const findWalletByEmail = createServerFn({ method: "POST" })
  .validator((d: { token: string; email: string }) => d)
  .handler(async ({ data }) => {
    await requireAuth(data.token);

    // Look up auth user by email
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers();
    if (error) throw new Error("Failed to search users");

    const target = users.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
    if (!target) return null;

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id, wallet_number")
      .eq("user_id", target.id)
      .single();

    if (!wallet) return null;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", target.id)
      .single();

    return {
      wallet_id: wallet.id,
      wallet_number: wallet.wallet_number,
      full_name: profile?.full_name ?? target.email?.split("@")[0] ?? "Unknown",
      email: target.email,
    };
  });
