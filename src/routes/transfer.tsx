import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AppShell, Field, PageHeader, Panel, Status, btnPrimary, inputCls } from "@/components/rift/ui";

export const Route = createFileRoute("/transfer")({
  head: () => ({
    meta: [
      { title: "Send a transfer — RIFT Bank" },
      { name: "description", content: "Send bank or RIFT Money transfers, risk-checked by RIFT before they run." },
      { property: "og:title", content: "Send a transfer — RIFT Bank" },
      { property: "og:description", content: "Risk-checked transfers with RIFT KEY approval." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Transfer,
});

const steps = ["Request", "Risk check", "Authorization", "Execution", "Observed by RIFT"];

function Transfer() {
  const [rail, setRail] = useState<"bank" | "rfm">("bank");
  return (
    <AppShell>
      <PageHeader kicker="Transfer" title="Send money">
        RIFT checks every transfer for risk. High-risk transfers need RIFT KEY approval before they run.
      </PageHeader>
      <div className="grid lg:grid-cols-5 gap-4">
        <Panel title="Details" className="lg:col-span-3">
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-2 gap-2">
              {(["bank", "rfm"] as const).map((r) => (
                <Button variant="outline"
                  type="button"
                  key={r}
                  onClick={() => setRail(r)}
                  className={`panel px-3 py-3 text-left text-sm ${rail === r ? "border-primary" : ""}`}
                >
                  <span className="font-display font-semibold block">{r === "bank" ? "Bank transfer" : "RIFT Money"}</span>
                  <span className="text-muted-foreground text-xs">{r === "bank" ? "Internal RIFT ledger" : "On-chain · Sepolia"}</span>
                </Button>
              ))}
            </div>
            <Field label={rail === "bank" ? "Recipient account or email" : "Recipient wallet address"}>
              <input className={inputCls} placeholder={rail === "bank" ? "name@example.com" : "0x…"} />
            </Field>
            <Field label={rail === "bank" ? "Amount (USD)" : "Amount (RFM)"}>
              <input className={`${inputCls} font-mono`} inputMode="decimal" placeholder="0.00" />
            </Field>
            <Field label="Note">
              <input className={inputCls} placeholder="Optional" />
            </Field>
            <Button className={btnPrimary} disabled>Review transfer</Button>
            <p className="text-xs text-muted-foreground">Sending is turned off until accounts and the RIFT service are connected.</p>
          </form>
        </Panel>
        <Panel title="Lifecycle" className="lg:col-span-2">
          <ol className="grid gap-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="size-7 rounded-full border grid place-items-center font-mono text-xs">{i + 1}</span>
                <span className="flex-1 text-sm">{s}</span>
                <Status>pending</Status>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground mt-5">
            Risk scores, approvals and transaction records will only appear here once they come from the real services.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
