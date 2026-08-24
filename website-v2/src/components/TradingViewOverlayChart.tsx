import { useRef } from 'react';
import TradingViewChart from './TradingViewChart';
import type { MarketDataSource } from '../stores/useGameStore';

export default function TradingViewOverlayChart({
  pair,
  interval,
  marketDataSource,
  tradingViewSymbol,
}: {
  pair: string;
  interval: number;
  marketDataSource: MarketDataSource;
  tradingViewSymbol?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0e0c0d]">
      <TradingViewChart pair={pair} interval={String(interval)} marketDataSource={marketDataSource} tradingViewSymbol={tradingViewSymbol} />
    </div>
  );
}
