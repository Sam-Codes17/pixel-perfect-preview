import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { AppShell, Empty, Field, PageHeader, Panel, PaymentCard, btnPrimary, inputCls } from "@/components/rift/ui";

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
          <div className="grid gap-4 max-w-md">
            <PaymentCard />
            <PaymentCard variant="purple" />
            <p className="text-xs text-muted-foreground">Illustrative cards · not issued or connected</p>
          </div>
          <Panel title="Card purchases">
            <Empty>No purchases yet.</Empty>
          </Panel>
        </div>
        <Panel title="New card" className="md:col-span-2">
          <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
            <Field label="Card name"><input className={inputCls} placeholder="Groceries" /></Field>
            <Field label="Monthly limit (USD)"><input className={`${inputCls} font-mono`} placeholder="500.00" /></Field>
            <Button className={btnPrimary} disabled>Create card</Button>
            <p className="text-xs text-muted-foreground">You can create cards once accounts are connected.</p>
          </form>
        </Panel>
      </div>
    </AppShell>
  );
}
