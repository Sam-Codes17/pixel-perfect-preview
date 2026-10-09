import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Overview" },
  { to: "/transfer", label: "Transfer" },
  { to: "/cards", label: "Cards" },
  { to: "/rfm", label: "RIFT Money" },
  { to: "/activity", label: "Activity" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-6">
          <Link to="/" className="font-display font-bold tracking-tight text-lg">
            RIFT<span className="text-primary">/</span>BANK
          </Link>
          <nav className="flex gap-1 overflow-x-auto text-sm">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: true }}
                className="px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground whitespace-nowrap"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="border-b bg-accent/40">
        <p className="mx-auto max-w-6xl px-4 py-2 font-mono text-xs text-accent-foreground">
          Preview mode · not connected yet · no real balances, transactions or blockchain records
        </p>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <p className="label-mono">{kicker}</p>
      <h1 className="text-3xl md:text-4xl font-bold mt-1">{title}</h1>
      {children && <p className="text-muted-foreground mt-2 max-w-2xl">{children}</p>}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 ${className}`}>
      {title && <p className="label-mono mb-4">{title}</p>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">{children}</div>
  );
}

export function Status({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const c = { muted: "text-muted-foreground", ok: "text-success", warn: "text-warning", bad: "text-destructive" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${c}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-mono">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputCls =
  "w-full h-10 rounded-md bg-background border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export const btnPrimary =
  "inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed";
