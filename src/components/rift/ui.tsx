import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard, ArrowLeftRight, CreditCard, Wallet,
  ArrowUpDown, ShoppingBag, Settings, Search, X, Menu,
  ShieldCheck, ChevronDown, LogOut, MoreHorizontal
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const nav = [
  { to: "/",              label: "Dashboard",    icon: LayoutDashboard },
  { to: "/wallets",       label: "Wallets",      icon: Wallet },
  { to: "/transfer",      label: "Send Money",   icon: ArrowUpDown },
  { to: "/exchange",      label: "Exchange",     icon: ArrowLeftRight },
  { to: "/activity",      label: "Activity",     icon: ArrowUpDown },
  { to: "/cards",         label: "Cards",        icon: CreditCard },
  { to: "/merchants",     label: "Marketplace",  icon: ShoppingBag },
  { to: "/trust",         label: "Trust Score",  icon: ShieldCheck },
  { to: "/settings",      label: "Settings",     icon: Settings },
] as const;

export function AppShell({
  children,
  search,
  onSearch,
}: {
  children: ReactNode;
  search?: string;
  onSearch?: (value: string) => void;
}) {
  const { user, signOut } = useAuth();
  const [showSignOut, setShowSignOut] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const displayName = (user?.user_metadata?.["full_name"] as string | undefined)
    ?? user?.email?.split("@")[0]
    ?? "User";
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="bank-frame">
      {/* Desktop / Laptop Sidebar */}
      <aside className="bank-sidebar desktop-sidebar">
        <Link to="/" className="bank-brand">
          <span className="brand-mark" />
          RIFT Bank
        </Link>

        <div className="sidebar-profile mt-8 mb-5">
          <button
            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer"
            onClick={() => setShowSignOut(!showSignOut)}
          >
            <span className="profile-avatar">{initials}</span>
            <span className="text-left font-normal flex-1 min-w-0">
              <span className="block text-xs truncate font-medium">{displayName}</span>
              <span className="block text-[10px] text-muted-foreground truncate">{user?.email}</span>
            </span>
            <ChevronDown className="size-3 flex-shrink-0 text-muted-foreground" />
          </button>

          {showSignOut && (
            <button
              onClick={() => { signOut(); setShowSignOut(false); }}
              className="w-full flex items-center gap-2 mt-1 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="size-3" /> Sign out
            </button>
          )}
        </div>

        <nav className="bank-nav" aria-label="Main navigation">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              activeProps={{ className: "active" }}
            >
              <n.icon />
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-bottom mt-auto pt-8">
          <div className="border-t pt-4 grid gap-2">
            <Link
              to="/admin-trust"
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1 rounded transition-colors"
            >
              Admin Trust Console
            </Link>
            <span className="flex gap-2 px-2 text-[10px] text-muted-foreground items-center">
              <ShieldCheck className="size-4 text-success" />
              Supabase · Live
            </span>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header (<= 768px) */}
      <header className="mobile-header">
        <div className="flex items-center gap-2.5">
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" />
          </button>
          <Link to="/" className="bank-brand text-sm font-bold flex items-center gap-2">
            <span className="brand-mark" style={{ transform: "scale(0.85)" }} />
            <span>RIFT Bank</span>
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSignOut(!showSignOut)}
            className="flex items-center gap-1.5 p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="User profile menu"
          >
            <span className="profile-avatar size-7 text-[10px]">{initials}</span>
          </button>
        </div>

        {showSignOut && (
          <div className="mobile-profile-popover">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-medium truncate">{displayName}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user?.email}</p>
            </div>
            <Link
              to="/admin-trust"
              onClick={() => setShowSignOut(false)}
              className="block px-3 py-2 text-xs hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              Admin Trust Console
            </Link>
            <button
              onClick={() => { signOut(); setShowSignOut(false); }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="size-3" /> Sign out
            </button>
          </div>
        )}
      </header>

      {/* Mobile Slide-Over Drawer */}
      {mobileDrawerOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setMobileDrawerOpen(false)}>
          <div className="mobile-drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="bank-brand text-base font-bold flex items-center gap-2">
                <span className="brand-mark" style={{ transform: "scale(0.9)" }} />
                <span>RIFT Bank</span>
              </div>
              <button
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => setMobileDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="mobile-drawer-nav p-3 grid gap-1">
              {nav.map((n) => (
                <Link
                  key={n.to}
                  to={n.to}
                  onClick={() => setMobileDrawerOpen(false)}
                  activeOptions={{ exact: n.to === "/" }}
                  activeProps={{ className: "active" }}
                  className="mobile-drawer-link"
                >
                  <n.icon className="size-4 flex-shrink-0" />
                  <span>{n.label}</span>
                </Link>
              ))}
            </nav>

            <div className="mt-auto p-4 border-t border-border grid gap-2">
              <Link
                to="/admin-trust"
                onClick={() => setMobileDrawerOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-2 px-2 py-1.5 rounded transition-colors"
              >
                <ShieldCheck className="size-4 text-primary" /> Admin Trust Console
              </Link>
              <button
                onClick={() => { signOut(); setMobileDrawerOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
              >
                <LogOut className="size-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="bank-body">
        {/* Desktop / Laptop Topbar */}
        <header className="bank-topbar desktop-topbar">
          <div className="search-box relative w-[265px]">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input
              aria-label="Search"
              value={search ?? ""}
              onChange={(e) => onSearch?.(e.target.value)}
              placeholder="Search RIFT Bank…"
              readOnly={!onSearch}
              className="bg-card w-full h-9 rounded-full pl-10 pr-3 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="topbar-actions flex gap-3 items-center">
            <Link to="/transfer" className="inline-flex items-center gap-2 h-9 rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity" activeProps={{}}>
              <Wallet className="size-4" />
              <span className="action-label">Send money</span>
            </Link>
          </div>
        </header>

        <main className="bank-main-content">{children}</main>
      </div>

      {/* Mobile Bottom Navigation Bar (<= 768px) */}
      <nav className="mobile-bottom-nav">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: "active" }} className="mobile-nav-item">
          <LayoutDashboard className="size-4" />
          <span>Home</span>
        </Link>
        <Link to="/wallets" activeProps={{ className: "active" }} className="mobile-nav-item">
          <Wallet className="size-4" />
          <span>Wallets</span>
        </Link>
        <Link to="/transfer" activeProps={{ className: "active" }} className="mobile-nav-item mobile-nav-send">
          <div className="send-fab">
            <ArrowUpDown className="size-4" />
          </div>
          <span>Send</span>
        </Link>
        <Link to="/activity" activeProps={{ className: "active" }} className="mobile-nav-item">
          <ArrowLeftRight className="size-4" />
          <span>Activity</span>
        </Link>
        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="mobile-nav-item"
        >
          <MoreHorizontal className="size-4" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}

export function PageHeader({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-7">
      <p className="label-mono mb-1">{kicker}</p>
      <h1 className="text-2xl font-medium">{title}</h1>
      {children && <p className="text-muted-foreground text-sm mt-2 max-w-2xl">{children}</p>}
    </div>
  );
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-5 ${className}`}>
      {title && <h2 className="text-sm mb-4">{title}</h2>}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function Status({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "bad"; children: ReactNode }) {
  const c = { muted: "text-muted-foreground", ok: "text-success", warn: "text-warning", bad: "text-destructive" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${c}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function PaymentCard({ variant = "gold", cardName, masked, cardholder, expiry }: {
  variant?: "gold" | "purple";
  cardName?: string;
  masked?: string;
  cardholder?: string;
  expiry?: string;
}) {
  return (
    <div className={`payment-card ${variant}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="card-title">{cardName ?? (variant === "gold" ? "Premium" : "RIFT Network")}</p>
          {masked && <p className="text-sm mt-0.5">{masked}</p>}
        </div>
        {variant === "purple" && (
          <span className="card-emblem"><ShieldCheck className="size-4" /></span>
        )}
      </div>
      <div className="card-footer">
        <span>{cardholder ?? "—"}</span>
        <span>{expiry ?? "—"}</span>
      </div>
    </div>
  );
}
