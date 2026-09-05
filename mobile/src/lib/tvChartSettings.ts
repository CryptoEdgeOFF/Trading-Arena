const STORAGE_PREFIX = 'btf-tv-settings:';

export function resolveTvSettingsUserId(explicit?: string | null): string {
  const fromProp = explicit?.trim();
  return fromProp || 'guest';
}

export function loadTvChartSettings(userId?: string | null): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + resolveTvSettingsUserId(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function hasSavedTvChartProperties(settings: Record<string, string>): boolean {
  return Object.keys(settings).some((key) => (
    key === 'chartproperties'
    || key.includes('candleStyle')
    || key.includes('linetools')
    || key.includes('drawing')
  ));
}

/** Persist TradingView user settings locally, keyed by account — no server. */
export function createTvSettingsAdapter(userId?: string | null) {
  const settings = loadTvChartSettings(userId);
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const persist = () => {
    persistTimer = null;
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + resolveTvSettingsUserId(userId),
        JSON.stringify(settings),
      );
    } catch {
      // quota / private mode
    }
  };

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 400);
  };

  return {
    initialSettings: settings,
    setValue(key: string, value: string) {
      settings[key] = value;
      schedulePersist();
    },
    removeValue(key: string) {
      delete settings[key];
      schedulePersist();
    },
  };
}

const LAYOUT_PREFIX = 'btf-tv-layout:';

export function loadTvChartLayout(userId?: string | null): object | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFIX + resolveTvSettingsUserId(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTvChartLayout(state: object, userId?: string | null): void {
  try {
    window.localStorage.setItem(
      LAYOUT_PREFIX + resolveTvSettingsUserId(userId),
      JSON.stringify(state),
    );
  } catch {
    // quota / private mode
  }
}

export function persistTvChartLayout(
  widget: { save: (callback: (state: object) => void, options?: { includeDrawings?: boolean }) => void },
  userId?: string | null,
): void {
  try {
    widget.save((state) => {
      saveTvChartLayout(state, userId);
    }, { includeDrawings: true });
  } catch {
    // widget not ready / already removed
  }
}
