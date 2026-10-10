/**
 * RIFT Security Adapter
 *
 * This module is the single integration point between RIFT Bank
 * and the RIFT Security Platform. It normalises external findings
 * into the rift_security_findings table and applies score adjustments
 * according to the active scoring policy.
 *
 * INTEGRATION STATUS:
 *   - External RIFT API:          LIVE  (http://localhost:8001/api/v1/rift)
 *   - Internal scoring trigger:   ACTIVE
 *   - Ledger event hooks:         ACTIVE (via Postgres triggers)
 *   - Post-transfer ingestion:    ACTIVE (ingestRiftOperationFindings)
 */

import { supabaseAdmin } from "@/lib/supabase-server";

// ── External RIFT finding shape (normalised) ─────────────────────────────────
export interface RiftFinding {
  external_id: string;
  rift_transaction_id?: string | undefined;
  detection_event_id?: string | undefined;
  rule_id?: string | undefined;
  rule_name?: string | undefined;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  finding_type:
    | "REPLAY_ATTEMPT"
    | "BYPASS_ATTEMPT"
    | "TOKEN_MAPPING_VIOLATION"
    | "SUSPICIOUS_BURST"
    | "AMOUNT_MISMATCH"
    | "BENEFICIARY_MISMATCH"
    | "FINALITY_VIOLATION"
    | "REUSED_IDENTIFIER"
    | "INVALID_AUTH"
    | "UNMATCHED_EVENT"
    | "UNMAPPED_TOKEN"
    | "SUSPICIOUS_WITHDRAWAL"
    | "OTHER";
  affected_wallet_id?: string | undefined;
  sender_wallet_id?: string | undefined;
  receiver_wallet_id?: string | undefined;
  attributed_user_id?: string | undefined;
  attribution_role?: "ORIGINATOR" | "SENDER" | "RECEIVER" | "COUNTERPARTY" | "UNKNOWN" | undefined;
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED";
  evidence: Record<string, unknown>;
  finding_timestamp: string;
}

// ── Score delta map (mirrors policy config — single source of truth is the DB) ──
const FINDING_TYPE_DELTA: Record<string, { key: string; rule: string }> = {
  REPLAY_ATTEMPT:              { key: "idempotency_replay_confirmed", rule: "RULE:RIFT_REPLAY" },
  BYPASS_ATTEMPT:              { key: "bypass_attempt_confirmed",     rule: "RULE:RIFT_BYPASS" },
  TOKEN_MAPPING_VIOLATION:     { key: "token_mapping_violation",      rule: "RULE:RIFT_TOKEN_MAP" },
  SUSPICIOUS_BURST:            { key: "suspicious_burst",             rule: "RULE:RIFT_BURST" },
  AMOUNT_MISMATCH:             { key: "suspicious_burst",             rule: "RULE:RIFT_AMT_MISMATCH" },
  BENEFICIARY_MISMATCH:        { key: "suspicious_burst",             rule: "RULE:RIFT_BENE_MISMATCH" },
  FINALITY_VIOLATION:          { key: "suspicious_burst",             rule: "RULE:RIFT_FINALITY" },
  REUSED_IDENTIFIER:           { key: "idempotency_replay_confirmed", rule: "RULE:RIFT_REUSE_ID" },
  INVALID_AUTH:                { key: "invalid_auth_repeat",          rule: "RULE:RIFT_AUTH" },
  SUSPICIOUS_WITHDRAWAL:       { key: "suspicious_burst",             rule: "RULE:RIFT_WITHDRAWAL" },
  UNMAPPED_TOKEN:              { key: "token_mapping_violation",      rule: "RULE:RIFT_UNMAPPED_TOKEN" },
  UNMATCHED_EVENT:             { key: "suspicious_burst",             rule: "RULE:RIFT_UNMATCHED" },
};

const CATEGORY_MAP: Record<string, string> = {
  REPLAY_ATTEMPT:          "SECURITY_COMPLIANCE",
  BYPASS_ATTEMPT:          "SECURITY_COMPLIANCE",
  TOKEN_MAPPING_VIOLATION: "SECURITY_COMPLIANCE",
  SUSPICIOUS_BURST:        "SUSPICIOUS_ACTIVITY",
  AMOUNT_MISMATCH:         "SUSPICIOUS_ACTIVITY",
  BENEFICIARY_MISMATCH:    "SUSPICIOUS_ACTIVITY",
  FINALITY_VIOLATION:      "SECURITY_COMPLIANCE",
  REUSED_IDENTIFIER:       "SECURITY_COMPLIANCE",
  INVALID_AUTH:            "ACCOUNT_SECURITY",
  SUSPICIOUS_WITHDRAWAL:   "SUSPICIOUS_ACTIVITY",
  UNMAPPED_TOKEN:          "SECURITY_COMPLIANCE",
  UNMATCHED_EVENT:         "SUSPICIOUS_ACTIVITY",
};

/**
 * Ingest a RIFT security finding and apply an idempotent
 * score adjustment if the finding meets policy thresholds.
 *
 * - Idempotent: same external_id is never processed twice.
 * - Only CONFIRMED findings trigger permanent score changes.
 * - OPEN / UNDER_REVIEW findings create provisional adjustments.
 * - Finding is stored regardless of attribution eligibility.
 */
export async function ingestRiftFinding(finding: RiftFinding): Promise<{
  finding_id: string;
  adjustment_id: string | null;
  skipped: boolean;
  reason: string;
}> {
  // 1. Idempotency — skip if already ingested
  const { data: existing } = await supabaseAdmin
    .from("rift_security_findings")
    .select("id, score_adjustment_id")
    .eq("external_id", finding.external_id)
    .single();

  if (existing) {
    return {
      finding_id: existing.id,
      adjustment_id: existing.score_adjustment_id,
      skipped: true,
      reason: "Already ingested",
    };
  }

  // 2. Store the finding first
  const { data: stored, error: storeErr } = await supabaseAdmin
    .from("rift_security_findings")
    .insert({
      external_id:         finding.external_id,
      rift_transaction_id: finding.rift_transaction_id ?? null,
      detection_event_id:  finding.detection_event_id ?? null,
      rule_id:             finding.rule_id ?? null,
      rule_name:           finding.rule_name ?? null,
      severity:            finding.severity,
      finding_type:        finding.finding_type,
      affected_wallet_id:  finding.affected_wallet_id ?? null,
      sender_wallet_id:    finding.sender_wallet_id ?? null,
      receiver_wallet_id:  finding.receiver_wallet_id ?? null,
      attributed_user_id:  finding.attributed_user_id ?? null,
      attribution_role:    finding.attribution_role ?? "UNKNOWN",
      confidence:          finding.confidence,
      evidence:            finding.evidence,
      finding_timestamp:   finding.finding_timestamp,
      status:              finding.confidence === "CONFIRMED" ? "CONFIRMED" : "OPEN",
    })
    .select("id")
    .single();

  if (storeErr || !stored) {
    throw new Error(`Failed to store finding: ${storeErr?.message}`);
  }

  // 3. Only apply score adjustment if there is an attributed user
  if (!finding.attributed_user_id) {
    return {
      finding_id: stored.id,
      adjustment_id: null,
      skipped: false,
      reason: "No attributed user — finding stored, no score change",
    };
  }

  // 4. Determine if policy applies a score change
  const mapping = FINDING_TYPE_DELTA[finding.finding_type];
  if (!mapping) {
    return {
      finding_id: stored.id,
      adjustment_id: null,
      skipped: false,
      reason: `Finding type ${finding.finding_type} has no configured policy mapping`,
    };
  }

  // 5. Get active policy config
  const { data: policy } = await supabaseAdmin
    .from("trust_score_policy")
    .select("config, version")
    .eq("is_active", true)
    .single();

  if (!policy) {
    return { finding_id: stored.id, adjustment_id: null, skipped: false, reason: "No active policy" };
  }

  const configDelta = (policy.config?.adjustments?.[mapping.key] as number) ?? 0;
  if (configDelta === 0) {
    return { finding_id: stored.id, adjustment_id: null, skipped: false, reason: "Policy delta is 0 for this type" };
  }

  const isProvisional = finding.confidence !== "CONFIRMED";
  const idemKey = `rift-finding-adj-${finding.external_id}`;
  const category = CATEGORY_MAP[finding.finding_type] ?? "SECURITY_COMPLIANCE";

  const explanation = `RIFT Security: ${finding.rule_name ?? finding.finding_type}` +
    ` (${finding.severity} severity, ${finding.confidence} confidence).` +
    (isProvisional ? " Provisional — pending investigation." : " Confirmed violation.");

  const { data: adjResult, error: adjErr } = await supabaseAdmin.rpc("apply_score_adjustment", {
    p_user_id:             finding.attributed_user_id,
    p_idempotency_key:     idemKey,
    p_delta:               configDelta,
    p_category:            category,
    p_explanation:         explanation,
    p_rule_reference:      mapping.rule,
    p_is_provisional:      isProvisional,
    p_related_tx_id:       null,
    p_related_incident_id: stored.id,
  });

  if (adjErr) throw new Error(`Score adjustment failed: ${adjErr.message}`);

  const adjId = adjResult?.[0]?.adjustment_id ?? null;

  // 6. Link finding → adjustment
  if (adjId) {
    await supabaseAdmin
      .from("rift_security_findings")
      .update({ score_adjustment_id: adjId })
      .eq("id", stored.id);
  }

  // 7. Refresh label
  await supabaseAdmin.rpc("refresh_trust_profile_label", { p_user_id: finding.attributed_user_id });

  return {
    finding_id: stored.id,
    adjustment_id: adjId,
    skipped: false,
    reason: isProvisional ? "Provisional adjustment applied" : "Confirmed adjustment applied",
  };
}

/**
 * Fetch findings from a specific RIFT operation via the live investigation endpoint.
 * Maps the operation's risk_assessment into RiftFinding format for trust score ingestion.
 */
export async function fetchExternalRiftFindings(riftOperationId?: string): Promise<{
  available: boolean;
  findings: RiftFinding[];
  message: string;
}> {
  const baseUrl = (typeof process !== "undefined" && process.env["RIFT_API_BASE_URL"])
    ? process.env["RIFT_API_BASE_URL"].replace(/\/$/, "")
    : "http://localhost:8001/api/v1/rift";

  const apiKey = (typeof process !== "undefined" && process.env["RIFT_API_KEY"])
    ? process.env["RIFT_API_KEY"]
    : undefined;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-RIFT-API-Key"] = apiKey;

  if (!riftOperationId) {
    return { available: true, findings: [], message: "No operation ID provided — nothing to fetch." };
  }

  try {
    const res = await fetch(`${baseUrl}/investigation/${riftOperationId}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { available: false, findings: [], message: `RIFT HTTP ${res.status}` };
    }

    const data = await res.json();
    // Investigations contain the full operation; extract anomaly_indicators as findings
    const anomalies: string[] = data.anomaly_indicators ?? [];
    const op = data.operation ?? {};
    const risk = op.risk_assessment ?? {};

    const findings: RiftFinding[] = anomalies.map((indicator: string, i: number): RiftFinding => ({
      external_id:        `${riftOperationId}-anomaly-${i}`,
      rift_transaction_id: riftOperationId,
      detection_event_id: `${riftOperationId}-evt-${i}`,
      rule_id:            risk.policy_matched ?? "RIFT_INVESTIGATION",
      rule_name:          indicator,
      severity:           risk.risk_level === "CRITICAL" ? "CRITICAL" : risk.risk_level === "ELEVATED" ? "HIGH" : "LOW",
      finding_type:       "SUSPICIOUS_BURST",
      confidence:         data.forensic_verdict === "VERIFIED_LEGITIMATE_TREASURY_FLOW" ? "LOW" : "HIGH",
      evidence:           { operation_id: riftOperationId, indicator, investigation: data },
      finding_timestamp:  new Date().toISOString(),
    }));

    return {
      available: true,
      findings,
      message: findings.length > 0
        ? `${findings.length} anomaly indicator(s) ingested from RIFT investigation ${riftOperationId}`
        : `RIFT investigation ${riftOperationId} returned no anomaly indicators (clean operation).`,
    };
  } catch (err: any) {
    return {
      available: false,
      findings: [],
      message: `RIFT investigation fetch failed: ${err.message ?? "Connection error"}`,
    };
  }
}

/**
 * Ingest security findings from a real RIFT operation into the trust score engine.
 * Called after a RIFT-integrated transfer completes (or is rejected).
 *
 * @param riftOperationId - The rift_operation_id from RIFT's response
 * @param userId - The bank user ID to attribute findings to
 * @param riskAssessment - The risk_assessment block from the RIFT response
 */
export async function ingestRiftOperationFindings(params: {
  riftOperationId: string;
  userId: string;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  riskScore: number;
  policyMatched: string;
  factors: string[];
}): Promise<{ ingested: boolean; finding_id: string | null; adjustment_id: string | null }> {
  // Only ingest if risk level warrants a finding
  if (params.riskLevel === "LOW" && params.riskScore < 0.4) {
    return { ingested: false, finding_id: null, adjustment_id: null };
  }

  const severity: RiftFinding["severity"] =
    params.riskLevel === "CRITICAL" ? "CRITICAL" :
    params.riskLevel === "ELEVATED" ? "HIGH" : "LOW";

  const finding: RiftFinding = {
    external_id:        `rift-op-${params.riftOperationId}-${params.userId.slice(0, 8)}`,
    rift_transaction_id: params.riftOperationId,
    detection_event_id: `evt-op-${params.riftOperationId}`,
    rule_id:            params.policyMatched,
    rule_name:          `RIFT Policy: ${params.policyMatched}`,
    severity,
    finding_type:       params.riskLevel === "CRITICAL" ? "BYPASS_ATTEMPT" : "SUSPICIOUS_BURST",
    attributed_user_id: params.userId,
    attribution_role:   "ORIGINATOR",
    confidence:         params.riskLevel === "CRITICAL" ? "CONFIRMED" : "MEDIUM",
    evidence:           {
      rift_operation_id: params.riftOperationId,
      risk_score:        params.riskScore,
      risk_level:        params.riskLevel,
      policy_matched:    params.policyMatched,
      factors:           params.factors,
    },
    finding_timestamp: new Date().toISOString(),
  };

  const result = await ingestRiftFinding(finding);
  return {
    ingested: !result.skipped,
    finding_id: result.finding_id,
    adjustment_id: result.adjustment_id,
  };
}

/**
 * Simulate a RIFT finding for testing purposes.
 * Only callable server-side. Never auto-applied.
 */
export async function simulateRiftFinding(params: {
  finding_type: RiftFinding["finding_type"];
  severity: RiftFinding["severity"];
  confidence: RiftFinding["confidence"];
  attributed_user_id: string;
  rule_id?: string | undefined;
  rule_name?: string | undefined;
  note?: string | undefined;
}): Promise<ReturnType<typeof ingestRiftFinding>> {
  const finding: RiftFinding = {
    external_id:        `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    detection_event_id: `evt-sim-${Date.now()}`,
    rule_id:            params.rule_id ?? `SIM_RULE_${params.finding_type}`,
    rule_name:          params.rule_name ?? `Simulated: ${params.finding_type}`,
    severity:           params.severity,
    finding_type:       params.finding_type,
    attributed_user_id: params.attributed_user_id,
    attribution_role:   "ORIGINATOR",
    confidence:         params.confidence,
    evidence:           { simulated: true, note: params.note ?? "Test finding", ts: new Date().toISOString() },
    finding_timestamp:  new Date().toISOString(),
  };

  return ingestRiftFinding(finding);
}
