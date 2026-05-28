import type { OhlcCandle, OhlcQueryOptions } from './kraken.js';
import * as binance from './binance.js';
import * as bybit from './bybit.js';
import * as itick from './itick.js';

/**
 * Source unique d'historique OHLC pour les pairs crypto, avec une chaîne
 * de fallback explicite et ordonnée :
 *
 *   1. iTick (region BA) — spot Binance, EXACTEMENT ce que TradingView et
 *                          notre flux live affichent. Source de référence
 *                          pour que historique = live = TradingView, et non
 *                          géo-bloquée (couvre le 451 sur IP datacenter).
 *   2. Binance Futures   — fallback profond/rapide si iTick est indispo.
 *   3. Bybit V5          — venue indépendante, dernier recours toujours up.
 *
 * On passe au maillon suivant dès qu'un fournisseur échoue OU renvoie zéro
 * bougie. Le premier qui répond avec des données gagne.
 */

export type CryptoCandleSource = 'binance' | 'itick' | 'bybit';

export interface CryptoCandleResult {
  candles: OhlcCandle[];
  source: CryptoCandleSource;
}

type Provider = {
  name: CryptoCandleSource;
  enabled: boolean;
  fetch: () => Promise<OhlcCandle[]>;
};

function itickRowsToOhlc(rows: { time: number; open: number; high: number; low: number; close: number }[]): OhlcCandle[] {
  return rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }));
}

/**
 * Récupère l'historique crypto en parcourant la chaîne Binance → iTick →
 * Bybit. Lève une erreur uniquement si AUCUN maillon n'a pu fournir de
 * données.
 */
export async function getCryptoOhlc(
  pair: string,
  interval: number,
  opts: OhlcQueryOptions = {},
): Promise<CryptoCandleResult> {
  const providers: Provider[] = [
    {
      name: 'itick',
      enabled: itick.isConfigured(),
      fetch: async () => itickRowsToOhlc(
        await itick.getCryptoKline(pair, interval, { countBack: opts.countBack, to: opts.to }),
      ),
    },
    {
      name: 'binance',
      enabled: true,
      fetch: () => binance.getOhlcCandles(pair, interval, opts),
    },
    {
      name: 'bybit',
      enabled: true,
      fetch: () => bybit.getOhlcCandles(pair, interval, opts),
    },
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.enabled) continue;
    try {
      const candles = await provider.fetch();
      if (candles.length > 0) {
        if (provider.name !== 'itick') {
          console.warn(`[cryptoCandles] ${pair} ${interval}m servi par ${provider.name} (fallback)`);
        }
        return { candles, source: provider.name };
      }
      errors.push(`${provider.name}: 0 bougie`);
    } catch (err) {
      errors.push(`${provider.name}: ${(err as Error).message}`);
    }
  }

  throw new Error(`Historique crypto indisponible pour ${pair} (${errors.join(' | ')})`);
}
