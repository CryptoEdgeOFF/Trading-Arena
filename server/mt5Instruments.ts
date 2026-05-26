/** MT5 symbol → BTF paper-trading pair. Extend as you add symbols on the VPS. */
export const MT5_SYMBOL_TO_PAIR: Record<string, string> = {
  EURUSD: 'EUR/USD',
  XAUUSD: 'GOLD/USD',
  GOLD: 'GOLD/USD',
};

const PAIR_TO_MT5 = new Map(
  Object.entries(MT5_SYMBOL_TO_PAIR).map(([mt5, pair]) => [pair, mt5] as const),
);

export function normalizeMt5Symbol(raw: string): string {
  return String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function mt5SymbolToPair(symbol: string): string | null {
  const key = normalizeMt5Symbol(symbol);
  return MT5_SYMBOL_TO_PAIR[key] ?? null;
}

export function pairToMt5Symbol(pair: string): string | null {
  return PAIR_TO_MT5.get(pair) ?? null;
}

export function listMt5Symbols(): string[] {
  return [...new Set(Object.values(MT5_SYMBOL_TO_PAIR))];
}
