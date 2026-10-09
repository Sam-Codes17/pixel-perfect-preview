import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, Empty, PageHeader, Panel, Status } from "@/components/rift/ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RIFT Bank — Overview" },
      { name: "description", content: "Your RIFT Bank accounts, RIFT Money balance and security status." },
      { property: "og:title", content: "RIFT Bank — Overview" },
      { property: "og:description", content: "Accounts, RIFT Money and fraud-protected transfers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

function Overview() {
  return (
    <AppShell>
      <PageHeader kicker="Overview" title="Your money, watched by RIFT">
        Balances, cards and transfers. Every transfer is risk-checked before it runs.
      </PageHeader>
      <div className="grid md:grid-cols-3 gap-4">
        <Panel title="Bank balance">
          <p className="font-mono text-3xl">—</p>
          <Status>Ledger not connected</Status>
        </Panel>
        <Panel title="RIFT Money (RFM)">
          <p className="font-mono text-3xl">—</p>
          <Status>Sepolia not connected</Status>
        </Panel>
        <Panel title="Security">
          <p className="font-display text-xl">RIFT risk engine</p>
          <Status tone="warn">Awaiting connection</Status>
        </Panel>
      </div>
      <div className="grid md:grid-cols-3 gap-4 mt-4">
        <Panel title="Recent activity" className="md:col-span-2">
          <Empty>No transactions yet.</Empty>
        </Panel>
        <Panel title="Quick actions">
          <div className="grid gap-2 text-sm">
            <Link to="/transfer" className="panel px-3 py-2 hover:border-primary">Send a transfer →</Link>
            <Link to="/cards" className="panel px-3 py-2 hover:border-primary">Manage cards →</Link>
            <Link to="/rfm" className="panel px-3 py-2 hover:border-primary">RIFT Money →</Link>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
