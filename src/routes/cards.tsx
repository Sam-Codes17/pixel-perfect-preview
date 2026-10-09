import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Empty, Field, PageHeader, Panel, Status, btnPrimary, inputCls } from "@/components/rift/ui";

export const Route = createFileRoute("/cards")({
  head: () => ({
    meta: [
      { title: "Virtual cards — RIFT Bank" },
      { name: "description", content: "RIFT Network virtual cards for internal merchants, with limits and risk checks." },
      { property: "og:title", content: "Virtual cards — RIFT Bank" },
      { property: "og:description", content: "RIFT Network virtual cards with spending limits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Cards,
});

function Cards() {
  return (
    <AppShell>
      <PageHeader kicker="Cards" title="RIFT Network virtual cards">
        These cards work only at merchants inside the RIFT Network. They aren't Visa or Mastercard cards and can't be used anywhere else.
      </PageHeader>
      <div className="grid md:grid-cols-5 gap-4">
        <div className="md:col-span-3 grid gap-4">
          <div className="panel p-6 aspect-[1.6] max-w-md flex flex-col justify-between bg-gradient-to-br from-accent to-card">
            <div className="flex justify-between">
              <span className="font-display font-bold">RIFT<span className="text-primary">/</span>NET</span>
              <Status>no card</Status>
            </div>
            <div>
              <p className="font-mono text-lg tracking-widest text-muted-foreground">•••• •••• •••• ••••</p>
              <p className="label-mono mt-2">Internal merchants only</p>
            </div>
          </div>
          <Panel title="Card purchases">
            <Empty>No purchases yet.</Empty>
          </Panel>
        </div>
        <Panel title="New card" className="md:col-span-2">
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <Field label="Card name"><input className={inputCls} placeholder="Groceries" /></Field>
            <Field label="Monthly limit (USD)"><input className={`${inputCls} font-mono`} placeholder="500.00" /></Field>
            <button className={btnPrimary} disabled>Create card</button>
            <p className="text-xs text-muted-foreground">You can create cards once accounts are connected.</p>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
