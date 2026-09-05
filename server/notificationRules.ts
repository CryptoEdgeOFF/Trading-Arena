export const DRAWDOWN_WARNING_RATIO = 0.8;

export function drawdownBufferConsumedRatio(
  baselineEquity: number,
  equity: number,
  limitEquity: number,
): number {
  const availableBuffer = baselineEquity - limitEquity;
  if (!Number.isFinite(availableBuffer) || availableBuffer <= 0) return 0;
  return (baselineEquity - equity) / availableBuffer;
}

export function shouldWarnDailyDrawdown(
  consumedRatio: number,
  warnedDayKey: string | null | undefined,
  dayKey: string,
): boolean {
  return consumedRatio >= DRAWDOWN_WARNING_RATIO && warnedDayKey !== dayKey;
}

export function shouldNotifyCompletedLimit(
  trade: { id: string; orderId?: string; action: string; orderType: string },
  openOrderIds: ReadonlySet<string>,
): boolean {
  if (trade.action !== 'open' || trade.orderType !== 'limit') return false;
  return !openOrderIds.has(trade.orderId || trade.id);
}

export function tradingClosePushKind(
  closeReason: string | undefined,
): 'take_profit' | 'stop_loss' | null {
  if (closeReason === 'take-profit') return 'take_profit';
  if (closeReason === 'stop-loss') return 'stop_loss';
  return null;
}

export function isPodiumLoss(previousRank: number | undefined, nextRank: number): boolean {
  return Boolean(previousRank && previousRank <= 3 && nextRank > 3);
}

export function shouldAnnounceNewArenaPush(input: {
  initialized: boolean;
  isPublic: boolean;
  alreadyNotified: boolean;
  status: string;
}): boolean {
  return input.initialized && input.isPublic && !input.alreadyNotified && input.status !== 'ended';
}

export function shouldSendNewsPush(article: { published?: boolean; pushSentAt?: number | null }): boolean {
  return Boolean(article.published) && !article.pushSentAt;
}

export const REGISTER_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REGISTER_REMINDER_1H_MS = 60 * 60 * 1000;
export const NO_TRADE_REMINDER_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
export const NO_TRADE_REMINDER_GRACE_MS = 24 * 60 * 60 * 1000;

export function shouldSendRegisterReminder24h(input: {
  isPublic: boolean;
  alreadyNotified: boolean;
  status: string;
  msUntilStart: number;
}): boolean {
  return (
    input.isPublic
    && !input.alreadyNotified
    && input.status === 'registration'
    && input.msUntilStart > 0
    && input.msUntilStart <= REGISTER_REMINDER_WINDOW_MS
  );
}

export function shouldSkipRegisterReminder24h(input: {
  alreadyNotified: boolean;
  status: string;
}): boolean {
  return !input.alreadyNotified && (input.status === 'starting_soon' || input.status === 'live' || input.status === 'ended');
}

export function shouldSendRegisterReminder1h(input: {
  isPublic: boolean;
  alreadyNotified: boolean;
  status: string;
  msUntilStart: number;
}): boolean {
  return (
    input.isPublic
    && !input.alreadyNotified
    && input.status === 'registration'
    && input.msUntilStart > 0
    && input.msUntilStart <= REGISTER_REMINDER_1H_MS
  );
}

export function shouldSkipRegisterReminder1h(input: {
  alreadyNotified: boolean;
  status: string;
}): boolean {
  return !input.alreadyNotified && (input.status === 'starting_soon' || input.status === 'live' || input.status === 'ended');
}

export function shouldSendNoTradeReminder(input: {
  alreadyNotified: boolean;
  status: string;
  msSinceStart: number;
}): boolean {
  if (input.alreadyNotified || input.status !== 'live') return false;
  return input.msSinceStart >= NO_TRADE_REMINDER_AFTER_MS
    && input.msSinceStart <= NO_TRADE_REMINDER_AFTER_MS + NO_TRADE_REMINDER_GRACE_MS;
}

export function shouldSkipNoTradeReminder(input: {
  alreadyNotified: boolean;
  status: string;
  msSinceStart: number;
}): boolean {
  if (input.alreadyNotified) return false;
  if (input.status === 'ended') return true;
  return input.status === 'live' && input.msSinceStart > NO_TRADE_REMINDER_AFTER_MS + NO_TRADE_REMINDER_GRACE_MS;
}

export function buildTradingPushPayload(input: {
  kind: 'order_filled' | 'take_profit' | 'stop_loss' | 'drawdown_warning';
  pair?: string;
  side?: 'long' | 'short';
  price?: number;
  pnl?: number;
  competitionTitle?: string;
  remaining?: number;
}): { title: string; body: string; kind: typeof input.kind } {
  if (input.kind === 'order_filled') {
    return {
      kind: input.kind,
      title: 'Ordre limite exécuté',
      body: `${input.side === 'long' ? 'Achat' : 'Vente'} ${input.pair} exécuté à ${Number(input.price || 0).toLocaleString('fr-FR')}.`,
    };
  }
  if (input.kind === 'drawdown_warning') {
    return {
      kind: input.kind,
      title: 'Attention au Daily Drawdown',
      body: `Tu as consommé 80 % de ta limite dans ${input.competitionTitle}. Il te reste ${Number(input.remaining || 0).toFixed(2)} $.`,
    };
  }
  const isTakeProfit = input.kind === 'take_profit';
  return {
    kind: input.kind,
    title: isTakeProfit ? 'Take Profit touché' : 'Stop Loss touché',
    body: `${input.pair} clôturé à ${Number(input.price || 0).toLocaleString('fr-FR')} · PnL ${Number(input.pnl || 0) >= 0 ? '+' : ''}${Number(input.pnl || 0).toFixed(2)} $.`,
  };
}
