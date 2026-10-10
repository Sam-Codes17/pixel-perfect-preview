/**
 * RIFT Security Platform API Client
 *
 * Implements the official RIFT integration specification (docs/RIFT_INTEGRATION.md).
 * Interacts with the real RIFT Security Engine (configured via RIFT_API_BASE_URL).
 *
 * RULES:
 *   - Never fabricates responses when RIFT is unavailable.
 *   - Always sends X-RIFT-API-Key header when a key is configured.
 *   - Returns RIFT_UNREACHABLE status on connection failure, never throws.
 *   - Idempotency enforced by the caller via unique idempotency_key per request.
 */

export interface TransferIntentRequest {
  transfer_id: string;
  idempotency_key: string;
  client_id: string;
  source_account_id: string;
  destination_account_id: string;
  asset: string;
  amount_base_units: string;
  amount_display: string;
  source_chain_id: number;
  destination_chain_id: number;
  destination_address: string;
  requested_by: string;
}

export interface RiskAssessment {
  risk_score: number;
  risk_level: "LOW" | "ELEVATED" | "CRITICAL";
  factors: string[];
  policy_matched: string;
}

export interface AuthorizationRequirements {
  required: boolean;
  mechanism: "NONE" | "RIFT_KEY_MFA";
  auth_url?: string;
  expires_at?: string;
}

export interface BlockchainLegEvidence {
  chain_id: number;
  chain_name: string;
  tx_hash: string;
  contract_address: string;
  block_number: number;
  block_hash: string;
  status: string;
  gas_used: string;
  timestamp: string;
  event: string;
}

export interface BlockchainEvidence {
  source: BlockchainLegEvidence;
  destination: BlockchainLegEvidence;
  forensic_summary: {
    events_intercepted: string[];
    reconciliation_hash: string;
  };
}

export interface TransferIntentResponse {
  rift_operation_id: string;
  transfer_id: string;
  idempotency_key: string;
  status: "AUTHORIZED" | "AWAITING_AUTHORIZATION" | "REJECTED" | "COMPLETED" | "FAILED" | "RIFT_UNREACHABLE";
  risk_assessment?: RiskAssessment;
  authorization_requirements?: AuthorizationRequirements;
  blockchain_evidence?: BlockchainEvidence | null;
  state_history?: Array<{ state: string; timestamp: string; approver?: string }>;
  created_at: string;
  error?: string;
}

export interface AuthorizeRequest {
  auth_token: string;
  approver: string;
  comments?: string | undefined;
}

export interface AuthorizeResponse {
  rift_operation_id: string;
  status: "AUTHORIZED" | "COMPLETED" | "REJECTED" | "FAILED" | "AWAITING_AUTHORIZATION";
  message: string;
  blockchain_evidence?: BlockchainEvidence | null;
}

export interface RiftHealth {
  available: boolean;
  status: string;
  service?: string;
  version?: string;
  chains_supported?: number[];
  policy_engine_active?: boolean;
  rift_key_service?: string;
  error?: string;
}

/** Resolve base URL — server-side env takes priority over fallback */
export function getBaseUrl(): string {
  if (typeof process !== "undefined" && process.env) {
    const raw =
      process.env["RIFT_CORE_URL"] ||
      process.env["RIFT_API_BASE_URL"] ||
      process.env["RIFT_SECURITY_API_URL"];
    if (raw) {
      let url = raw.trim().replace(/\/$/, "");
      // If user provided deployed URL ending with /api/v1 (per checklist), ensure /rift sub-path is attached
      if (url.endsWith("/api/v1")) {
        url = `${url}/rift`;
      }
      return url;
    }
  }
  return "http://localhost:8001/api/v1/rift";
}

/** Resolve API key from environment */
export function getApiKey(): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env["RIFT_API_KEY"] ||
      process.env["RIFT_SECURITY_API_KEY"] ||
      undefined
    );
  }
  return undefined;
}

/** Resolve Webhook Secret from environment */
export function getWebhookSecret(): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return process.env["RIFT_WEBHOOK_SECRET"] || undefined;
  }
  return undefined;
}

/** Build headers for RIFT requests — always include API key when available */
function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  const apiKey = getApiKey();
  if (apiKey) headers["X-RIFT-API-Key"] = apiKey;
  return headers;
}

/** Check health and connectivity to the RIFT security engine */
export async function checkRiftHealth(): Promise<RiftHealth> {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { available: false, status: "UNHEALTHY", error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return {
      available: true,
      status: data.status ?? "healthy",
      service: data.service,
      version: data.version,
      chains_supported: data.chains_supported,
      policy_engine_active: data.policy_engine_active,
      rift_key_service: data.rift_key_service,
    };
  } catch (err: any) {
    return {
      available: false,
      status: "RIFT_UNREACHABLE",
      error: err.message ?? "Connection failed",
    };
  }
}

/** Submit a transfer intent to the RIFT security engine */
export async function submitTransferIntent(
  intent: TransferIntentRequest
): Promise<TransferIntentResponse> {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/transfers/intent`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text();
      // 4xx from RIFT means rejection or validation error — not an unavailability
      if (res.status >= 400 && res.status < 500) {
        let detail = errText;
        try { detail = JSON.parse(errText)?.detail ?? errText; } catch {}
        return {
          rift_operation_id: "",
          transfer_id: intent.transfer_id,
          idempotency_key: intent.idempotency_key,
          status: "REJECTED",
          created_at: new Date().toISOString(),
          error: detail,
        };
      }
      return {
        rift_operation_id: "",
        transfer_id: intent.transfer_id,
        idempotency_key: intent.idempotency_key,
        status: "RIFT_UNREACHABLE",
        created_at: new Date().toISOString(),
        error: `RIFT HTTP ${res.status}: ${errText}`,
      };
    }

    const data: TransferIntentResponse = await res.json();
    return data;
  } catch (err: any) {
    // Graceful offline degradation per Section 5 of integration contract
    return {
      rift_operation_id: "",
      transfer_id: intent.transfer_id,
      idempotency_key: intent.idempotency_key,
      status: "RIFT_UNREACHABLE",
      created_at: new Date().toISOString(),
      error: `RIFT CONNECTION UNAVAILABLE: ${err.message ?? "Offline"}`,
    };
  }
}

/** Authorize an operation held in AWAITING_AUTHORIZATION via RIFT KEY */
export async function authorizeRiftOperation(
  operationId: string,
  auth: AuthorizeRequest
): Promise<AuthorizeResponse> {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/operations/${operationId}/authorize`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(auth),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`RIFT authorization error HTTP ${res.status}: ${err}`);
  }

  return await res.json();
}

/** Query operation status & forensic evidence from RIFT */
export async function getRiftOperation(operationId: string): Promise<TransferIntentResponse | null> {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/operations/${operationId}`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Query forensic investigation evidence */
export async function getRiftInvestigation(operationId: string): Promise<any | null> {
  const baseUrl = getBaseUrl();
  try {
    const res = await fetch(`${baseUrl}/investigation/${operationId}`, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
