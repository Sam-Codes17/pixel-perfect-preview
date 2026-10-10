import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  sendMoney,
  authorizeTransferRiftKey,
  pollRiftOperationStatus,
  getRiftStatus,
} from "@/lib/server-fns/transfer";
import { findWalletByEmail, getWallet } from "@/lib/server-fns/wallet";
import { AppShell } from "@/components/rift/ui";
import { CURRENCY_LIST, CURRENCIES } from "@/lib/currencies";
import { formatAmount, generateIdempotencyKey } from "@/lib/format";
import {
  Search, Send, CheckCircle, AlertCircle, ChevronRight,
  ShieldCheck, ShieldAlert, KeyRound, ExternalLink, Hash, Layers,
  RefreshCw, XCircle, Clock
} from "lucide-react";

export const Route = createFileRoute("/_protected/transfer")({
  head: () => ({
    meta: [
      { title: "Send Money — RIFT Bank" },
      { name: "description", content: "Send RIFT ecosystem currencies to any registered user or external address." },
    ],
  }),
  component: Transfer,
});

type Step = "recipient" | "amount" | "review" | "rift_auth" | "done";

interface Recipient {
  wallet_id?: string | undefined;
  wallet_number?: string | undefined;
  full_name: string;
  email?: string | undefined;
  is_unregistered?: boolean | undefined;
  is_cross_chain?: boolean | undefined;
  destination_address?: string | undefined;
}

interface TxnResult {
  transaction_id: string;
  txn_status: string;
  is_pending_claim?: boolean;
  claim_token?: string;
  recipient_email?: string;
  rift_operation_id?: string;
  risk_assessment?: any;
  authorization_requirements?: any;
  blockchain_evidence?: any;
}

function Transfer() {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("recipient");
  const [recipientInput, setRecipientInput] = useState("");
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [findError, setFindError] = useState("");
  const [isUnregisteredChoice, setIsUnregisteredChoice] = useState(false);
  const [currency, setCurrency] = useState("RFM");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<TxnResult | null>(null);
  const [txnError, setTxnError] = useState("");
  const [idempKey, setIdempKey] = useState(generateIdempotencyKey);
  const [riftPollStatus, setRiftPollStatus] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // RIFT KEY MFA inputs
  const [mfaAuthToken, setMfaAuthToken] = useState("RIFT-KEY-SEC-AUTH-773821");
  const [mfaApprover, setMfaApprover] = useState("");
  const [mfaComments, setMfaComments] = useState("Approved transfer via RIFT KEY Security Protocol");
  const [mfaError, setMfaError] = useState("");

  const { data: wallet } = useQuery({
    queryKey: ["wallet", token],
    queryFn: () => getWallet({ data: { token } }),
    enabled: !!token,
  });

  const { data: riftHealth } = useQuery({
    queryKey: ["rift-health"],
    queryFn: () => getRiftStatus({ data: {} }),
    refetchInterval: 10000,
  });

  // Poll RIFT for status updates while a transaction is AWAITING_AUTHORIZATION
  useEffect(() => {
    if (step !== "rift_auth" || !result?.rift_operation_id) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      return;
    }
    const dopoll = async () => {
      try {
        const op = await pollRiftOperationStatus({ data: { token, rift_operation_id: result.rift_operation_id! } });
        setRiftPollStatus(op.status);
        if (op.status === "REJECTED" || op.status === "FAILED") {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setMfaError(`RIFT ${op.status}: Operation expired or was rejected by the RIFT security engine.`);
          setStep("review");
          setTxnError(`Transfer ${op.status.toLowerCase()} by RIFT security policy.`);
        } else if (op.status === "COMPLETED" && op.blockchain_evidence) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setResult((prev) => ({ ...prev!, txn_status: "COMPLETED", blockchain_evidence: op.blockchain_evidence }));
          setStep("done");
          queryClient.invalidateQueries({ queryKey: ["wallet"] });
          queryClient.invalidateQueries({ queryKey: ["transactions"] });
        }
      } catch { /* silent — polling is best-effort */ }
    };
    dopoll();
    pollIntervalRef.current = setInterval(dopoll, 5000);
    return () => { if (pollIntervalRef.current) clearInterval(pollIntervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, result?.rift_operation_id]);

  const findMutation = useMutation({
    mutationFn: async (input: string): Promise<Recipient | null> => {
      // Check if input is an EVM address
      if (input.startsWith("0x") && input.length >= 40) {
        return {
          full_name: `Cross-Chain Counterparty (${input.slice(0, 6)}...${input.slice(-4)})`,
          destination_address: input,
          is_cross_chain: true,
        };
      }
      return findWalletByEmail({ data: { token, email: input } });
    },
    onSuccess: (data) => {
      if (!data) {
        setFindError("No registered RIFT Bank user found with that email.");
        setIsUnregisteredChoice(true);
        return;
      }
      setRecipient(data as Recipient);
      setFindError("");
      setIsUnregisteredChoice(false);
      setStep("amount");
    },
    onError: (err) => {
      setFindError(String(err));
      setIsUnregisteredChoice(false);
    },
  });

  const chooseUnregisteredClaim = () => {
    setRecipient({
      full_name: recipientInput.split("@")[0] || "Unregistered Recipient",
      email: recipientInput,
      is_unregistered: true,
    });
    setFindError("");
    setIsUnregisteredChoice(false);
    setStep("amount");
  };

  const sendMutation = useMutation({
    mutationFn: () =>
      sendMoney({
        data: {
          token,
          currency_id: currency,
          amount: parseInt(amount, 10),
          idempotency_key: idempKey,
          ...(note ? { reference: note } : {}),
          ...(recipient?.wallet_id ? { receiver_wallet_id: recipient.wallet_id } : {}),
          ...(recipient?.is_unregistered && recipient.email ? { unregistered_email: recipient.email } : {}),
          ...(recipient?.destination_address ? { destination_address: recipient.destination_address } : {}),
        },
      }),
    onSuccess: (data: any) => {
      setResult(data as TxnResult);
      if (data?.txn_status === "AWAITING_AUTHORIZATION") {
        setStep("rift_auth");
      } else {
        setStep("done");
        queryClient.invalidateQueries({ queryKey: ["wallet"] });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
      }
    },
    onError: (err: any) => {
      const msg = String(err);
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        setTxnError("Insufficient balance for this transfer.");
      } else if (msg.includes("RIFT_REJECTED")) {
        setTxnError(msg);
      } else if (msg.includes("RIFT_UNREACHABLE")) {
        setTxnError("RIFT Security Platform is unreachable. Operation blocked for safety.");
      } else {
        setTxnError(`Transfer failed: ${err.message ?? msg}`);
      }
    },
  });

  const authMutation = useMutation({
    mutationFn: () =>
      authorizeTransferRiftKey({
        data: {
          token,
          rift_operation_id: result?.rift_operation_id ?? "",
          auth_token: mfaAuthToken,
          approver: mfaApprover || "Authorized Client",
          comments: mfaComments,
        },
      }),
    onSuccess: (data: any) => {
      setResult((prev) => ({
        ...prev!,
        txn_status: "COMPLETED",
        blockchain_evidence: data.blockchain_evidence,
      }));
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err: any) => {
      setMfaError(`Authorization failed: ${err.message}`);
    },
  });

  const selectedCur = CURRENCIES[currency as keyof typeof CURRENCIES];
  const balance = wallet?.balances?.find((b) => b.currency_id === currency)?.available_balance ?? 0;
  const numAmount = parseInt(amount || "0", 10);

  return (
    <AppShell>
      <div className="mb-7 flex justify-between items-start">
        <div>
          <p className="label-mono mb-1">Transfer</p>
          <h1 className="text-2xl font-medium">Send Money</h1>
          <p className="text-muted-foreground text-sm mt-2">
            Real-time financial transfer within the RIFT ecosystem and cross-chain execution.
          </p>
        </div>

        {/* Live RIFT Security Platform indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs">
          {riftHealth?.available ? (
            <>
              <ShieldCheck className="size-4 text-emerald-400" />
              <span className="text-emerald-400 font-mono">RIFT Security: Active</span>
            </>
          ) : (
            <>
              <ShieldAlert className="size-4 text-amber-400" />
              <span className="text-amber-400 font-mono">RIFT Connection Unavailable</span>
            </>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="step-bar">
        {(["recipient", "amount", "review", "done"] as Step[]).map((s, i) => (
          <div
            key={s}
            className={`step-item ${step === s ? "active" : ["recipient", "amount", "review", "rift_auth", "done"].indexOf(step) > i ? "done" : ""}`}
          >
            <span className="step-dot">
              {["recipient", "amount", "review", "rift_auth", "done"].indexOf(step) > i ? "✓" : i + 1}
            </span>
            <span className="step-label">{["Recipient", "Amount", "Review", "Sent"][i]}</span>
            {i < 3 && <ChevronRight className="size-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-4 mt-4">
        <div className="lg:col-span-3 panel p-6">
          {/* Step 1: Find recipient */}
          {step === "recipient" && (
            <div className="grid gap-4">
              <h2 className="text-sm font-medium">Find recipient</h2>
              <label className="block">
                <span className="label-mono">Recipient email or external address</span>
                <div className="relative mt-1.5">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <input
                    className="w-full h-10 rounded-md bg-background border pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="user@example.com or 0x70997970C51..."
                    value={recipientInput}
                    onChange={(e) => {
                      setRecipientInput(e.target.value);
                      setIsUnregisteredChoice(false);
                      setFindError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && findMutation.mutate(recipientInput)}
                  />
                </div>
              </label>

              {findError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-xs">
                  <p className="text-destructive flex items-center gap-1.5 mb-2">
                    <AlertCircle className="size-3.5" />
                    {findError}
                  </p>
                  {isUnregisteredChoice && (
                    <div className="mt-2 pt-2 border-t border-destructive/20">
                      <p className="text-muted-foreground mb-2">
                        Recipient does not have a RIFT Bank account yet. You can still send funds via a secure pending escrow claim.
                      </p>
                      <button
                        onClick={chooseUnregisteredClaim}
                        className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold"
                      >
                        Send as Pending Escrow Claim
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                onClick={() => findMutation.mutate(recipientInput)}
                disabled={findMutation.isPending || !recipientInput}
              >
                {findMutation.isPending ? "Searching…" : "Find recipient"}
              </button>
            </div>
          )}

          {/* Step 2: Amount */}
          {step === "amount" && recipient && (
            <div className="grid gap-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <span className="size-9 rounded-full bg-secondary grid place-items-center font-bold text-primary">
                  {recipient.full_name[0]}
                </span>
                <div>
                  <p className="text-sm font-medium">{recipient.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {recipient.is_unregistered ? (
                      <span className="text-amber-400 font-mono">Unregistered · Pending Escrow Claim</span>
                    ) : recipient.is_cross_chain ? (
                      <span className="text-cyan-400 font-mono">Cross-Chain (Chain 31338)</span>
                    ) : (
                      `${recipient.email} · ${recipient.wallet_number}`
                    )}
                  </p>
                </div>
              </div>

              <label className="block">
                <span className="label-mono">Currency</span>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {CURRENCY_LIST.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCurrency(c.id)}
                      className={`p-3 rounded-lg border text-left text-sm transition-colors ${currency === c.id ? "border-primary bg-accent" : "border-border hover:border-muted-foreground"}`}
                    >
                      <span className="font-semibold" style={{ color: c.color }}>{c.symbol}</span>
                      <span className="block text-xs text-muted-foreground mt-0.5">{c.name}</span>
                    </button>
                  ))}
                </div>
              </label>

              <label className="block">
                <span className="label-mono">Amount ({currency})</span>
                <input
                  className="w-full h-10 rounded-md bg-background border px-3 text-sm font-mono mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
                  type="number"
                  min="1"
                  max={balance}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Available: {formatAmount(balance)} {currency}
                </p>
              </label>

              <label className="block">
                <span className="label-mono">Note (optional)</span>
                <input
                  className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="Payment reference…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>

              <div className="flex gap-3">
                <button onClick={() => setStep("recipient")} className="h-10 px-4 rounded-full border text-sm">Back</button>
                <button
                  onClick={() => setStep("review")}
                  disabled={!amount || numAmount <= 0 || numAmount > balance}
                  className="flex-1 h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Review transfer
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {step === "review" && recipient && (
            <div className="grid gap-4">
              <h2 className="text-sm font-medium">Confirm transfer</h2>
              <dl className="grid gap-3 text-sm">
                {[
                  ["Recipient", recipient.full_name],
                  ["Target Type", recipient.is_unregistered ? "Pending Escrow Claim" : recipient.is_cross_chain ? "Cross-Chain EVM" : "Registered RIFT Account"],
                  ["Destination", recipient.destination_address ?? recipient.email ?? recipient.wallet_number ?? "—"],
                  ["Currency", `${selectedCur?.name} (${currency})`],
                  ["Amount", formatAmount(numAmount) + " " + currency],
                  ["Note", note || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border pb-2.5 last:border-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-right text-xs break-all">{v}</dd>
                  </div>
                ))}
              </dl>

              {txnError && (
                <p className="text-destructive text-xs flex items-center gap-1.5 p-3 rounded-lg bg-destructive/10">
                  <AlertCircle className="size-4 shrink-0" />
                  {txnError}
                </p>
              )}

              <div className="flex gap-3">
                <button onClick={() => { setStep("amount"); setTxnError(""); }} className="h-10 px-4 rounded-full border text-sm">Back</button>
                <button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                  className="flex-1 h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {sendMutation.isPending ? <span className="auth-spinner" /> : <Send className="size-4" />}
                  {sendMutation.isPending ? "Submitting…" : "Confirm & send"}
                </button>
              </div>
            </div>
          )}

          {/* Step 3b: RIFT KEY Authorization Required */}
          {step === "rift_auth" && result && (
            <div className="grid gap-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <KeyRound className="size-5 shrink-0" />
                <div>
                  <p className="font-medium text-xs">RIFT KEY MFA Authorization Required</p>
                  <p className="text-[11px] opacity-80">
                    Operation {result.rift_operation_id} is held pending cryptographic approval.
                  </p>
                </div>
              </div>

              {/* Live RIFT status badge from polling */}
              {riftPollStatus && riftPollStatus !== "AWAITING_AUTHORIZATION" && (
                <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted border">
                  <RefreshCw className="size-3.5 animate-spin" />
                  <span className="font-mono">RIFT Status: {riftPollStatus}</span>
                </div>
              )}

              {result.risk_assessment && (
                <div className="p-3 rounded-lg bg-muted text-xs font-mono space-y-1">
                  <p className="text-muted-foreground">Policy Matched: <span className="text-foreground">{result.risk_assessment.policy_matched}</span></p>
                  <p className="text-muted-foreground">Risk Score: <span className="text-amber-400">{(result.risk_assessment.risk_score * 100).toFixed(0)}%</span> &nbsp;|&nbsp; Level: <span className="text-amber-400">{result.risk_assessment.risk_level}</span></p>
                  <ul className="list-disc pl-4 mt-1 opacity-80">
                    {result.risk_assessment.factors?.map((f: string, i: number) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.authorization_requirements?.expires_at && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="size-3.5 shrink-0" />
                  <span>Authorization expires: <span className="font-mono text-foreground">{new Date(result.authorization_requirements.expires_at).toLocaleTimeString()}</span></span>
                </div>
              )}

              <label className="block">
                <span className="label-mono">RIFT KEY Auth Token</span>
                <input
                  className="w-full h-10 rounded-md bg-background border px-3 text-sm font-mono mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
                  value={mfaAuthToken}
                  onChange={(e) => setMfaAuthToken(e.target.value)}
                  placeholder="RIFT-KEY-SEC-AUTH-..."
                />
              </label>

              <label className="block">
                <span className="label-mono">Signer / Approver</span>
                <input
                  className="w-full h-10 rounded-md bg-background border px-3 text-sm mt-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
                  value={mfaApprover}
                  onChange={(e) => setMfaApprover(e.target.value)}
                  placeholder="Alexander Veyron (Biometric Signer)"
                />
              </label>

              {mfaError && (
                <p className="text-destructive text-xs flex items-center gap-1.5">
                  <AlertCircle className="size-4 shrink-0" />
                  {mfaError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => authMutation.mutate()}
                  disabled={authMutation.isPending || !mfaAuthToken}
                  className="flex-1 h-10 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {authMutation.isPending ? <span className="auth-spinner" /> : <KeyRound className="size-4" />}
                  {authMutation.isPending ? "Verifying RIFT KEY…" : "Authorize with RIFT KEY"}
                </button>
              </div>

              <p className="text-[11px] text-muted-foreground text-center">
                Polling RIFT for status updates every 5s. If expired, the operation will auto-reject.
              </p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && result && (
            <div className="grid gap-4 text-center py-4">
              <CheckCircle className="size-12 text-success mx-auto" />
              <h2 className="text-lg font-medium text-success">
                {result.is_pending_claim ? "Escrow Claim Created!" : "Transfer Complete!"}
              </h2>
              <p className="text-muted-foreground text-sm">
                {formatAmount(numAmount)} {currency} {result.is_pending_claim ? "reserved in transit escrow for" : "sent to"} {recipient?.full_name}
              </p>

              <div className="p-3 rounded-lg bg-muted text-left space-y-2">
                <div>
                  <p className="label-mono text-[10px]">Transaction ID</p>
                  <p className="font-mono text-xs break-all">{result.transaction_id}</p>
                </div>
                {result.rift_operation_id && (
                  <div>
                    <p className="label-mono text-[10px]">RIFT Operation ID</p>
                    <p className="font-mono text-xs text-primary break-all">{result.rift_operation_id}</p>
                  </div>
                )}
                {result.claim_token && (
                  <div>
                    <p className="label-mono text-[10px]">Secure Claim Token</p>
                    <p className="font-mono text-xs text-amber-400 break-all">{result.claim_token}</p>
                  </div>
                )}
              </div>

              {/* Verified Blockchain Evidence */}
              {result.blockchain_evidence && (
                <div className="p-3 rounded-lg border bg-card/60 text-left space-y-2 text-xs">
                  <p className="font-semibold text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="size-4" />
                    Verified Local Blockchain Evidence
                  </p>
                  <div className="grid gap-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Source L1 Tx:</span>
                      <span className="text-foreground truncate max-w-[220px]">{result.blockchain_evidence.source?.tx_hash}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Dest L2 Tx:</span>
                      <span className="text-foreground truncate max-w-[220px]">{result.blockchain_evidence.destination?.tx_hash}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reconciliation Hash:</span>
                      <span className="text-cyan-400 truncate max-w-[220px]">{result.blockchain_evidence.forensic_summary?.reconciliation_hash}</span>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  setStep("recipient");
                  setRecipient(null);
                  setRecipientInput("");
                  setAmount("");
                  setNote("");
                  setResult(null);
                  setIdempKey(generateIdempotencyKey());
                }}
                className="h-10 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground mx-auto"
              >
                Send another
              </button>
            </div>
          )}
        </div>

        {/* Lifecycle panel */}
        <div className="lg:col-span-2 panel p-5">
          <h2 className="text-sm font-medium mb-4">Transfer lifecycle</h2>
          <ol className="grid gap-3">
            {[
              "Validate recipient / counterparty",
              "Check balance & limits",
              "RIFT Security Risk Assessment",
              "Execute settlement / Escrow reservation",
              "Finality & Forensic Evidence",
            ].map((s, i) => {
              const done = step === "done" || (step === "review" && i < 2) || (step === "amount" && i < 1);
              return (
                <li key={s} className="flex items-center gap-3">
                  <span className={`size-7 rounded-full border grid place-items-center font-mono text-xs ${done ? "border-success text-success" : "border-border text-muted-foreground"}`}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="flex-1 text-sm">{s}</span>
                </li>
              );
            })}
          </ol>
          <div className="mt-5 p-3 rounded-lg bg-muted text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground">Operational Guarantees:</p>
            <p>• Atomic ledger debit & credit (no double-entry discrepancies).</p>
            <p>• Idempotent execution via unique request keys.</p>
            <p>• Autonomous RIFT Security Policy screening.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
