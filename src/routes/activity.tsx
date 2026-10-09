import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Empty, PageHeader, Panel } from "@/components/rift/ui";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity — RIFT Bank" },
      { name: "description", content: "Transfers, card purchases, risk decisions and security events." },
      { property: "og:title", content: "Activity — RIFT Bank" },
      { property: "og:description", content: "Your full transaction and security history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Activity,
});

const cols = ["Time", "Type", "Counterparty", "Amount", "Risk", "Status", "Proof"];

function Activity() {
  return (
    <AppShell>
      <PageHeader kicker="Activity" title="History and security events" />
      <Panel title="Transactions">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>{cols.map((c) => <th key={c} className="label-mono text-left pb-3 pr-4">{c}</th>)}</tr>
            </thead>
          </table>
        </div>
        <Empty>Nothing to show yet.</Empty>
      </Panel>
      <Panel title="Security events" className="mt-4">
        <Empty>RIFT alerts and warnings will show here.</Empty>
      </Panel>
    </AppShell>
  );
}
