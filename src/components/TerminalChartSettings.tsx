import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a8 8 0 0 0-1.7-1L15 3.5h-6l-.5 2.5a8 8 0 0 0-1.7 1L4.5 6.4l-2 3.4 2 1.2a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.4 2.3-.6a8 8 0 0 0 1.7 1l.5 2.5h6l.5-2.5a8 8 0 0 0 1.7-1l2.3.6 2-3.4-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChartSettingToggle({
  checked,
  onChange,
  label,
  className = '',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  className?: string;
}) {
  return (
    <label className={`tv-show-trades ${className}`.trim()}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onChange(!checked)}
      />
      {label}
    </label>
  );
}

export function TerminalChartSettingsMenu({
  showTrades,
  onShowTradesChange,
  soundEnabled,
  onSoundChange,
}: {
  showTrades: boolean;
  onShowTradesChange: (show: boolean) => void;
  soundEnabled: boolean;
  onSoundChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="tv-chart-settings">
      <button
        type="button"
        className="tv-chart-settings-btn"
        aria-expanded={open}
        aria-label={t('terminal.chartSettings')}
        onClick={() => setOpen((value) => !value)}
      >
        <GearIcon />
      </button>
      {open && (
        <div className="tv-chart-settings-menu" role="menu">
          <ChartSettingToggle
            className="is-menu"
            checked={showTrades}
            onChange={onShowTradesChange}
            label={t('terminal.showTrades')}
          />
          <ChartSettingToggle
            className="is-menu"
            checked={soundEnabled}
            onChange={onSoundChange}
            label={t('terminal.enableSound')}
          />
        </div>
      )}
    </div>
  );
}
