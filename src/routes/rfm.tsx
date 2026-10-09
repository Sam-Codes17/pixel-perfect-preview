import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Empty, PageHeader, Panel, Status } from "@/components/rift/ui";

export const Route = createFileRoute("/rfm")({
  head: () => ({
    meta: [
      { title: "RIFT Money (RFM) — RIFT Bank" },
      { name: "description", content: "RIFT Money demo token on the Sepolia test network." },
      { property: "og:title", content: "RIFT Money (RFM) — RIFT Bank" },
      { property: "og:description", content: "A demonstration token on Sepolia, not real money." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Rfm,
});

const rows = [
  ["Network", "Sepolia test network"],
  ["Chain ID", "11155111"],
  ["Token contract", "Not deployed yet"],
  ["Decimals", "18"],
  ["Your wallet", "Not linked"],
];

function Rfm() {
  return (
    <AppShell>
      <PageHeader kicker="RIFT Money" title="RFM demo token">
        RFM is a demonstration token on a test network. It has no real-world value.
      </PageHeader>
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Token">
          <dl className="grid gap-3 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b pb-2 last:border-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Balance">
          <p className="font-mono text-4xl">— <span className="text-lg text-muted-foreground">RFM</span></p>
          <div className="mt-2"><Status>Read from the chain once connected</Status></div>
          <p className="text-xs text-muted-foreground mt-6">
            Your RFM balance on the chain is kept separate from your bank balance in RIFT's records.
          </p>
        </Panel>
        <Panel title="On-chain transfers" className="md:col-span-2">
          <Empty>No transfers seen on the chain yet. Each one will show its real transaction ID and block number.</Empty>
        </Panel>
      </div>
    </AppShell>
  );
}
