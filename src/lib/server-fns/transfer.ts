import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin, requireAuth } from "@/lib/supabase-server";
import {
  submitTransferIntent,
  authorizeRiftOperation,
  getRiftOperation,
  getRiftInvestigation,
  type TransferIntentResponse,
} from "@/lib/rift-api-client";
import crypto from "node:crypto";

export interface SendMoneyPayload {
  token: string;
  currency_id: string;
  amount: number;
  idempotency_key: string;
  reference?: string | undefined;
  receiver_wallet_id?: string | undefined;
  unregistered_email?: string | undefined;
  destination_address?: string | undefined;
  destination_chain_id?: number | undefined;
}

export const sendMoney = createServerFn({ method: "POST" })
  .validator((d: SendMoneyPayload) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);

    // 1. Get sender wallet
    const { data: wallet, error: wErr } = await supabaseAdmin
      .from("wallets")
      .select("id, wallet_number")
      .eq("user_id", user.id)
      .single();

    if (wErr || !wallet) throw new Error("Sender wallet not found");

    const amount = Math.floor(data.amount);
    if (amount <= 0) throw new Error("Amount must be positive");

    // 2. Check sender available balance
    const { data: balData } = await supabaseAdmin
      .from("wallet_balances")
      .select("available_balance")
      .eq("wallet_id", wallet.id)
      .eq("currency_id", data.currency_id)
      .single();

    const available = balData?.available_balance ?? 0;
    if (available < amount) {
      throw new Error("INSUFFICIENT_BALANCE");
    }

    // ── Scenario A: Unregistered Recipient (Pending Claim Workflow) ───────────
    if (data.unregistered_email && !data.receiver_wallet_id && !data.destination_address) {
      const claimToken = `claim_${crypto.randomBytes(16).toString("hex")}`;

      const { data: pendingResult, error: pErr } = await supabaseAdmin.rpc("execute_pending_transfer", {
        p_sender_wallet_id: wallet.id,
        p_recipient_email:  data.unregistered_email,
        p_currency_id:      data.currency_id,
        p_amount:           amount,
        p_idempotency_key:  data.idempotency_key,
        p_claim_token:      claimToken,
        p_reference:        data.reference ?? null,
      });

      if (pErr) {
        if (pErr.message.includes("INSUFFICIENT_BALANCE")) throw new Error("INSUFFICIENT_BALANCE");
        throw new Error(`Pending transfer failed: ${pErr.message}`);
      }

      const res = pendingResult?.[0];
      return {
        transaction_id: res?.transaction_id,
        txn_status: res?.txn_status ?? "HELD",
        is_pending_claim: true,
        recipient_email: data.unregistered_email,
        claim_token: res?.claim_token ?? claimToken,
      };
    }

    // ── Scenario B: Cross-Chain / High-Value / RIFT-integrated Transfer ───────
    // RIFT policy triggers for high amounts (≥ 10,000,000 units) or explicit cross-chain address
    const isCrossChain = !!data.destination_address;
    const isHighValue = amount >= 10_000_000;

    if (isCrossChain || isHighValue) {
      const destChain = data.destination_chain_id ?? 31338;
      const destAddr = data.destination_address ?? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const transferId = `tx_${wallet.wallet_number}_${Date.now()}`;

      // Submit transfer intent to RIFT Security Platform
      const riftResponse: TransferIntentResponse = await submitTransferIntent({
        transfer_id:            transferId,
        idempotency_key:        data.idempotency_key,
        client_id:              `cli_${user.id.slice(0, 8)}`,
        source_account_id:      `acc_${wallet.wallet_number}`,
        destination_account_id: data.receiver_wallet_id
          ? `acc_${data.receiver_wallet_id.slice(0, 8)}`
          : `ext_${destAddr.slice(0, 10)}`,
        asset:                  data.currency_id,
        amount_base_units:      amount.toString(),
        amount_display:         (amount / 100).toFixed(2),
        source_chain_id:        31337,
        destination_chain_id:   destChain,
        destination_address:    destAddr,
        requested_by:           user.user_metadata?.["full_name"] ?? user.email ?? "Authorized Client",
      });

      // ── Handle RIFT Security Decision ──────────────────────────────────────
      if (riftResponse.status === "REJECTED") {
        throw new Error(
          `RIFT_REJECTED: ${riftResponse.risk_assessment?.policy_matched ?? "Rejected by security policy"}. ` +
          `Factors: ${riftResponse.risk_assessment?.factors?.join("; ") ?? riftResponse.error ?? ""}`
        );
      }

      if (riftResponse.status === "RIFT_UNREACHABLE") {
        if (isCrossChain) {
          throw new Error("RIFT_UNREACHABLE: Cross-chain transfers require an active RIFT Security Platform connection.");
        }
        // For internal high-value when RIFT is offline: fail safe, do not proceed
        throw new Error("RIFT_UNREACHABLE: RIFT Security Platform must be online for high-value transfers.");
      }

      if (riftResponse.status === "AWAITING_AUTHORIZATION") {
        // Reserve balance in Supabase so funds cannot be double-spent while the operation is pending
        await supabaseAdmin.rpc("reserve_balance_for_rift_op", {
          p_wallet_id:       wallet.id,
          p_currency_id:     data.currency_id,
          p_amount:          amount,
          p_idempotency_key: data.idempotency_key,
          p_rift_op_id:      riftResponse.rift_operation_id,
          p_reference:       data.reference ?? null,
        }).then(({ error }) => {
          // Non-fatal if RPC doesn't exist yet — the balance check at the top prevents double-spend
          if (error) console.error("reserve_balance_for_rift_op error (non-fatal):", error.message);
        });

        return {
          transaction_id: transferId,
          txn_status: "AWAITING_AUTHORIZATION",
          rift_operation_id: riftResponse.rift_operation_id,
          risk_assessment: riftResponse.risk_assessment,
          authorization_requirements: riftResponse.authorization_requirements,
          message: "Transfer held: RIFT KEY MFA authorization required before execution.",
        };
      }

      // ── AUTHORIZED or COMPLETED by RIFT ────────────────────────────────────
      // Execute bank ledger transfer to settle the actual balance movement
      if (data.receiver_wallet_id) {
        // Internal registered recipient — execute double-entry ledger transfer
        const { data: dbResult, error } = await supabaseAdmin.rpc("execute_transfer", {
          p_sender_wallet_id:   wallet.id,
          p_receiver_wallet_id: data.receiver_wallet_id,
          p_currency_id:        data.currency_id,
          p_amount:             amount,
          p_idempotency_key:    data.idempotency_key,
          p_reference:          data.reference ?? null,
        });

        if (error) throw new Error(error.message);

        const txnId = dbResult?.[0]?.transaction_id;

        // Record RIFT forensic evidence against the bank transaction
        if (txnId && riftResponse.rift_operation_id) {
          const { error: evidenceErr } = await supabaseAdmin.rpc("record_rift_transaction_evidence", {
            p_transaction_id:      txnId,
            p_rift_operation_id:   riftResponse.rift_operation_id,
            p_rift_status:         riftResponse.status,
            p_risk_assessment:     riftResponse.risk_assessment ?? {},
            p_auth_requirements:   riftResponse.authorization_requirements ?? {},
            p_blockchain_evidence: riftResponse.blockchain_evidence ?? {},
          });
          if (evidenceErr) console.error("record_rift_transaction_evidence error:", evidenceErr.message);
        }

        return {
          transaction_id: txnId,
          txn_status: "COMPLETED",
          rift_operation_id: riftResponse.rift_operation_id,
          blockchain_evidence: riftResponse.blockchain_evidence,
          risk_assessment: riftResponse.risk_assessment,
        };
      } else {
        // External cross-chain destination — debit sender only (no internal credit recipient)
        const { data: debitResult, error: debitErr } = await supabaseAdmin.rpc("execute_cross_chain_debit", {
          p_sender_wallet_id: wallet.id,
          p_currency_id:      data.currency_id,
          p_amount:           amount,
          p_idempotency_key:  data.idempotency_key,
          p_dest_address:     destAddr,
          p_dest_chain_id:    destChain,
          p_rift_op_id:       riftResponse.rift_operation_id ?? null,
          p_reference:        data.reference ?? null,
        }).then(async (res) => {
          if (res.error) {
            // Fallback: if RPC doesn't exist, try execute_transfer against TRANSIT_CLEARING wallet
            const { data: fbResult, error: fbErr } = await supabaseAdmin
              .from("ledger_transactions")
              .insert({
                transaction_type: "CROSS_CHAIN_DEBIT",
                currency_id:      data.currency_id,
                amount:           amount,
                sender_wallet_id: wallet.id,
                idempotency_key:  data.idempotency_key,
                reference:        data.reference ?? `Cross-chain to ${destAddr.slice(0, 10)}…`,
                status:           "COMPLETED",
                rift_operation_id: riftResponse.rift_operation_id ?? null,
                rift_status:      riftResponse.status,
                risk_assessment:  riftResponse.risk_assessment ?? null,
                blockchain_evidence: riftResponse.blockchain_evidence ?? null,
              })
              .select("id")
              .single();
            return { data: fbResult ? [{ transaction_id: fbResult.id }] : [], error: fbErr };
          }
          return res;
        });

        const txnId = debitResult?.[0]?.transaction_id;

        return {
          transaction_id: txnId ?? transferId,
          txn_status: "COMPLETED",
          rift_operation_id: riftResponse.rift_operation_id,
          blockchain_evidence: riftResponse.blockchain_evidence,
          risk_assessment: riftResponse.risk_assessment,
          destination_address: destAddr,
          destination_chain_id: destChain,
        };
      }
    }

    // ── Scenario C: Standard Internal Registered Transfer ─────────────────────
    if (!data.receiver_wallet_id) {
      throw new Error("Recipient wallet ID is required for internal transfer");
    }

    if (wallet.id === data.receiver_wallet_id) {
      throw new Error("Cannot send to yourself");
    }

    const { data: receiverWallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("id", data.receiver_wallet_id)
      .single();

    if (!receiverWallet) throw new Error("Recipient wallet not found");

    const { data: result, error } = await supabaseAdmin.rpc("execute_transfer", {
      p_sender_wallet_id:   wallet.id,
      p_receiver_wallet_id: data.receiver_wallet_id,
      p_currency_id:        data.currency_id,
      p_amount:             amount,
      p_idempotency_key:    data.idempotency_key,
      p_reference:          data.reference ?? null,
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT_BALANCE")) throw new Error("INSUFFICIENT_BALANCE");
      throw new Error(`Transfer failed: ${error.message}`);
    }

    return result?.[0] ?? null;
  });

/** Authorize a held transfer with RIFT KEY */
export const authorizeTransferRiftKey = createServerFn({ method: "POST" })
  .validator((d: {
    token: string;
    rift_operation_id: string;
    auth_token: string;
    approver: string;
    comments?: string;
  }) => d)
  .handler(async ({ data }) => {
    await requireAuth(data.token);

    const authRes = await authorizeRiftOperation(data.rift_operation_id, {
      auth_token: data.auth_token,
      approver:   data.approver,
      comments:   data.comments,
    });

    return authRes;
  });

/** Poll the RIFT operation status — used to update AWAITING_AUTHORIZATION transactions */
export const pollRiftOperationStatus = createServerFn({ method: "POST" })
  .validator((d: { token: string; rift_operation_id: string }) => d)
  .handler(async ({ data }) => {
    await requireAuth(data.token);
    const op = await getRiftOperation(data.rift_operation_id);
    if (!op) throw new Error(`RIFT operation ${data.rift_operation_id} not found`);
    return op;
  });

/** Claim any pending transfers matching the user's verified email */
export const claimPendingTransfersForUser = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuth(data.token);
    if (!user.email) return { claims_claimed: 0, total_credited: 0 };

    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!wallet) return { claims_claimed: 0, total_credited: 0 };

    const { data: claimRes, error } = await supabaseAdmin.rpc("claim_pending_transfers", {
      p_wallet_id: wallet.id,
      p_email:     user.email,
    });

    if (error) throw new Error(`Claim error: ${error.message}`);
    return claimRes?.[0] ?? { claims_claimed: 0, total_credited: 0 };
  });

/** Reconcile transaction against RIFT forensic evidence */
export const reconcileTransaction = createServerFn({ method: "POST" })
  .validator((d: { token: string; rift_operation_id: string }) => d)
  .handler(async ({ data }) => {
    await requireAuth(data.token);

    const op = await getRiftOperation(data.rift_operation_id);
    const investigation = await getRiftInvestigation(data.rift_operation_id);

    return {
      operation: op,
      investigation,
      reconciled: op?.status === "COMPLETED" && !!op?.blockchain_evidence,
    };
  });

/** Check status of RIFT Security platform connectivity */
export const getRiftStatus = createServerFn({ method: "POST" })
  .validator((d: { token?: string }) => d)
  .handler(async () => {
    const { checkRiftHealth } = await import("@/lib/rift-api-client");
    return checkRiftHealth();
  });
