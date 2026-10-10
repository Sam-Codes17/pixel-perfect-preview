export type CurrencyId = "RFM" | "AUR" | "NEX" | "VELA";

export interface Currency {
  id: CurrencyId;
  name: string;
  symbol: string;
  color: string;
  bgColor: string;
  glowColor: string;
  initial: number;
  exchangeRates: Record<string, number>;
}

export const CURRENCIES: Record<CurrencyId, Currency> = {
  RFM: {
    id: "RFM",
    name: "RIFT Money",
    symbol: "RFM",
    color: "#d4a843",
    bgColor: "rgba(212,168,67,0.12)",
    glowColor: "rgba(212,168,67,0.3)",
    initial: 10_000_000,
    exchangeRates: { AUR: 0.25, NEX: 0.5, VELA: 0.075 },
  },
  AUR: {
    id: "AUR",
    name: "Auric",
    symbol: "AUR",
    color: "#c9a227",
    bgColor: "rgba(201,162,39,0.12)",
    glowColor: "rgba(201,162,39,0.3)",
    initial: 2_500_000,
    exchangeRates: { RFM: 4.0, NEX: 2.0, VELA: 0.3 },
  },
  NEX: {
    id: "NEX",
    name: "Nexus",
    symbol: "NEX",
    color: "#8b5cf6",
    bgColor: "rgba(139,92,246,0.12)",
    glowColor: "rgba(139,92,246,0.3)",
    initial: 5_000_000,
    exchangeRates: { RFM: 2.0, AUR: 0.5, VELA: 0.15 },
  },
  VELA: {
    id: "VELA",
    name: "Vela",
    symbol: "VELA",
    color: "#0ea5e9",
    bgColor: "rgba(14,165,233,0.12)",
    glowColor: "rgba(14,165,233,0.3)",
    initial: 750_000,
    exchangeRates: { RFM: 13.333, AUR: 3.333, NEX: 6.667 },
  },
};

export const CURRENCY_LIST = Object.values(CURRENCIES);

export function getCurrency(id: string): Currency | undefined {
  return CURRENCIES[id as CurrencyId];
}
