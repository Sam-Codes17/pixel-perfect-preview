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

    // ── 3. Resolve Receiver Details & Context ────────────────────────────────
    let receiverUserId: string | undefined;
    let receiverEmail: string | undefined;
    let receiverWalletNumber: string | undefined;

    if (data.receiver_wallet_id) {
      const { data: recWallet } = await supabaseAdmin
        .from("wallets")
        .select("id, user_id, wallet_number, profiles(id, full_name, email)")
        .eq("id", data.receiver_wallet_id)
        .single();
      if (recWallet) {
        receiverUserId = recWallet.user_id;
        receiverWalletNumber = recWallet.wallet_number;
        const prof = recWallet.profiles as any;
        receiverEmail = prof?.email;
      }
    } else if (data.unregistered_email) {
      receiverEmail = data.unregistered_email;
    }

    // ── 4. Compute Sender Anomaly Detection Context ─────────────────────────
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const { count: txCount1h } = await supabaseAdmin
      .from("ledger_transactions")
      .select("id", { count: "exact", head: true })
      .eq("sender_wallet_id", wallet.id)
      .gte("created_at", oneHourAgo);

    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const { data: recentTxs } = await supabaseAdmin
      .from("ledger_transactions")
      .select("amount")
      .eq("sender_wallet_id", wallet.id)
      .gte("created_at", oneDayAgo);
    const volume24h = (recentTxs ?? []).reduce((acc, t) => acc + (t.amount || 0), 0);

    const isCrossChain = !!data.destination_address;
    const isPendingClaim = !!data.unregistered_email && !data.receiver_wallet_id && !data.destination_address;
    const destChain = data.destination_chain_id ?? (isCrossChain ? 31338 : 31337);
    const destAddr = data.destination_address ?? "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const transferId = `tx_${wallet.wallet_number}_${Date.now()}`;

    // ── 5. Submit Transfer Intent to RIFT Security Engine ────────────────────
    const riftResponse: TransferIntentResponse = await submitTransferIntent({
      transfer_id: transferId,
      idempotency_key: data.idempotency_key,
      client_id: `cli_${user.id.slice(0, 8)}`,
      source_account_id: `acc_${wallet.wallet_number}`,
      destination_account_id: data.receiver_wallet_id
        ? `acc_${receiverWalletNumber || data.receiver_wallet_id.slice(0, 8)}`
        : data.destination_address
          ? `ext_${destAddr.slice(0, 10)}`
          : `claim_${data.unregistered_email}`,
      asset: data.currency_id,
      amount_base_units: amount.toString(),
      amount_display: (amount / 100).toFixed(2),
      source_chain_id: 31337,
      destination_chain_id: destChain,
      destination_address: destAddr,
      requested_by: user.user_metadata?.["full_name"] ?? user.email ?? "Authorized Client",
      sender_user_id: user.id,
      sender_email: user.email,
      receiver_user_id: receiverUserId,
      receiver_email: receiverEmail,
      recent_tx_count_1h: txCount1h ?? 0,
      volume_24h_base_units: volume24h.toString(),
      is_cross_chain: isCrossChain,
      bridge_protocol: isCrossChain ? "RIFT_CROSS_CHAIN_BRIDGE_CSB01" : "INTERNAL_LEDGER",
    });

    // ── 6. Handle Security Anomalies / Exploits (CSB-01) ──────────────────────
    if (riftResponse.status === "REJECTED") {
      const matchedRule = riftResponse.risk_assessment?.policy_matched || "CSB01_EXPLOIT_PREVENTION_BLOCKED";
      const factors = riftResponse.risk_assessment?.factors ?? ["Anomalous transaction pattern detected by RIFT Security Engine"];

      // Alert Sender
      await supabaseAdmin.from("rift_security_findings").insert({
        rift_transaction_id: transferId,
        rule_id: matchedRule,
        rule_name: "Cross-Chain Anomaly & Bridge Risk Alert",
        severity: "CRITICAL",
        finding_type: "OUTBOUND_TRANSACTION_BLOCKED",
        affected_wallet_id: wallet.id,
        sender_wallet_id: wallet.id,
        receiver_wallet_id: data.receiver_wallet_id ?? null,
        attributed_user_id: user.id,
        attribution_role: "SENDER",
        status: "OPEN",
        confidence: "CONFIRMED",
        evidence: {
          alert: "Outbound transfer blocked due to detected anomaly / exploit risk.",
          factors,
          amount,
          currency_id: data.currency_id,
          destination: destAddr,
          policy: matchedRule,
          timestamp: new Date().toISOString(),
        },
      });

      // Alert Receiver (if internal user)
      if (receiverUserId && data.receiver_wallet_id) {
        await supabaseAdmin.from("rift_security_findings").insert({
          rift_transaction_id: transferId,
          rule_id: matchedRule,
          rule_name: "Inbound Suspicious Transaction Alert",
          severity: "HIGH",
          finding_type: "INBOUND_COUNTERPARTY_BLOCKED",
          affected_wallet_id: data.receiver_wallet_id,
          sender_wallet_id: wallet.id,
          receiver_wallet_id: data.receiver_wallet_id,
          attributed_user_id: receiverUserId,
          attribution_role: "RECEIVER",
          status: "OPEN",
          confidence: "HIGH",
          evidence: {
            alert: "Inbound transfer from sender was blocked by RIFT Security Engine.",
            sender: wallet.wallet_number,
            factors,
            amount,
            currency_id: data.currency_id,
            timestamp: new Date().toISOString(),
          },
        });
      }

      throw new Error(
        `RIFT_SECURITY_ALERT: Transaction blocked. Risk factors: ${factors.join("; ")}. Both sender and receiver security profiles have been alerted.`
      );
    }

    if (riftResponse.status === "RIFT_UNREACHABLE") {
      if (isCrossChain || amount >= 10_000_000) {
        throw new Error("RIFT_UNREACHABLE: Cross-chain transfers require active RIFT Security Engine connection.");
      }
      // For small internal transfers when RIFT is offline: proceed with local transfer
      console.warn("[transfer] RIFT is offline; proceeding with internal local ledger transfer.");
    }

    if (riftResponse.status === "AWAITING_AUTHORIZATION") {
      // Record held finding
      await supabaseAdmin.from("rift_security_findings").insert({
        rift_transaction_id: transferId,
        rule_id: riftResponse.risk_assessment?.policy_matched || "RIFT_KEY_MFA_REQUIRED",
        rule_name: "RIFT KEY MFA Authorization Pending",
        severity: "MEDIUM",
        finding_type: "TRANSFER_HELD_AUTHORIZATION",
        affected_wallet_id: wallet.id,
        sender_wallet_id: wallet.id,
        receiver_wallet_id: data.receiver_wallet_id ?? null,
        attributed_user_id: user.id,
        attribution_role: "SENDER",
        status: "OPEN",
        confidence: "CONFIRMED",
        evidence: {
          factors: riftResponse.risk_assessment?.factors ?? [],
          amount,
          currency_id: data.currency_id,
          rift_operation_id: riftResponse.rift_operation_id,
        },
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

    // ── 7. Execute Settle According to Scenario ─────────────────────────────
    if (isPendingClaim) {
      const claimToken = `claim_${crypto.randomBytes(16).toString("hex")}`;
      const { data: pendingResult, error: pErr } = await supabaseAdmin.rpc("execute_pending_transfer", {
        p_sender_wallet_id: wallet.id,
        p_recipient_email: data.unregistered_email,
        p_currency_id: data.currency_id,
        p_amount: amount,
        p_idempotency_key: data.idempotency_key,
        p_claim_token: claimToken,
        p_reference: data.reference ?? null,
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
        rift_operation_id: riftResponse.rift_operation_id,
      };
    }

    if (isCrossChain) {
      const { data: debitResult, error: debitErr } = await supabaseAdmin.rpc("execute_cross_chain_debit", {
        p_sender_wallet_id: wallet.id,
        p_currency_id: data.currency_id,
        p_amount: amount,
        p_idempotency_key: data.idempotency_key,
        p_dest_address: destAddr,
        p_dest_chain_id: destChain,
        p_rift_op_id: riftResponse.rift_operation_id ?? null,
        p_reference: data.reference ?? null,
      }).then(async (res) => {
        if (res.error) {
          const { data: fbResult, error: fbErr } = await supabaseAdmin
            .from("ledger_transactions")
            .insert({
              transaction_type: "CROSS_CHAIN_DEBIT",
              currency_id: data.currency_id,
              amount: amount,
              sender_wallet_id: wallet.id,
              idempotency_key: data.idempotency_key,
              reference: data.reference ?? `Cross-chain to ${destAddr.slice(0, 10)}…`,
              status: "COMPLETED",
              rift_operation_id: riftResponse.rift_operation_id ?? null,
              rift_status: riftResponse.status,
              risk_assessment: riftResponse.risk_assessment ?? null,
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

    // Standard internal registered recipient transfer
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
      p_sender_wallet_id: wallet.id,
      p_receiver_wallet_id: data.receiver_wallet_id,
      p_currency_id: data.currency_id,
      p_amount: amount,
      p_idempotency_key: data.idempotency_key,
      p_reference: data.reference ?? null,
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT_BALANCE")) throw new Error("INSUFFICIENT_BALANCE");
      throw new Error(`Transfer failed: ${error.message}`);
    }

    const txnId = result?.[0]?.transaction_id;
    if (txnId && riftResponse.rift_operation_id) {
      await supabaseAdmin.rpc("record_rift_transaction_evidence", {
        p_transaction_id: txnId,
        p_rift_operation_id: riftResponse.rift_operation_id,
        p_rift_status: riftResponse.status,
        p_risk_assessment: riftResponse.risk_assessment ?? {},
        p_auth_requirements: riftResponse.authorization_requirements ?? {},
        p_blockchain_evidence: riftResponse.blockchain_evidence ?? {},
      }).then(({ error: evErr }) => {
        if (evErr) console.warn("record_rift_transaction_evidence note:", evErr.message);
      });
    }

    return {
      ...(result?.[0] ?? {}),
      rift_operation_id: riftResponse.rift_operation_id,
      risk_assessment: riftResponse.risk_assessment,
    };
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
