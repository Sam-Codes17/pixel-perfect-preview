/** Format a RIFT ecosystem amount (integer) with locale separators */
export function formatAmount(amount: number | bigint, currencyId?: string): string {
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  const formatted = num.toLocaleString("en-IN");
  return currencyId ? `${formatted} ${currencyId}` : formatted;
}

/** Format a compact amount (e.g. 10,000,000 → 1Cr) */
export function formatCompact(amount: number): string {
  if (amount >= 10_000_000) return `${(amount / 10_000_000).toFixed(2)}Cr`;
  if (amount >= 100_000) return `${(amount / 100_000).toFixed(2)}L`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString("en-IN");
}

/** Format a UTC timestamp to a human-readable date/time */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format a UTC timestamp to relative time (e.g. "2 hours ago") */
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Generate a UUID v4 idempotency key */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}
