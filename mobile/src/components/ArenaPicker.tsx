import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MyCompetition } from '../lib/api'
import { useI18n } from '../i18n'

function formatClock(ms: number, dayUnit: string): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86_400)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(Math.floor((total % 86_400) / 3_600))}h ${pad(Math.floor((total % 3_600) / 60))}m ${pad(total % 60)}s`
  return days > 0 ? `${days}${dayUnit} ${clock}` : clock
}

function statusRank(status: MyCompetition['status']): number {
  if (status === 'live') return 0
  if (status === 'starting_soon') return 1
  if (status === 'registration') return 2
  return 3
}

function sortArenas(arenas: MyCompetition[], currentId?: string): MyCompetition[] {
  return [...arenas]
    .filter((arena) => arena.status !== 'ended' || arena.id === currentId)
    .sort((a, b) => {
      if (a.id === currentId) return -1
      if (b.id === currentId) return 1
      const tradeDelta = Number(Boolean(b.canTrade)) - Number(Boolean(a.canTrade))
      if (tradeDelta) return tradeDelta
      return statusRank(a.status) - statusRank(b.status) || a.endAt - b.endAt
    })
}

function ArenaCard({
  arena,
  current,
  busy,
  now,
  onSelect,
}: {
  arena: MyCompetition
  current: boolean
  busy: boolean
  now: number
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const pnl = arena.myEntry?.pnlUsd
  const pnlPos = (pnl ?? 0) >= 0
  const status = arena.status === 'live' ? t('terminal.arenaLive')
    : arena.status === 'starting_soon' ? t('terminal.arenaSoon')
      : arena.status === 'registration' ? t('terminal.arenaOpen')
        : t('terminal.arenaEnded')
  const clock = arena.status === 'ended'
    ? t('terminal.arenaEnded')
    : arena.status === 'live'
      ? t('terminal.arenaEndsIn', { time: formatClock(arena.endAt - now, t('nextArena.dayUnit')) })
      : t('terminal.arenaStartsIn', { time: formatClock(arena.startAt - now, t('nextArena.dayUnit')) })

  return (
    <button
      type="button"
      className={`arena-pick-card is-${arena.status}${current ? ' is-current' : ''}${!arena.canTrade ? ' is-locked' : ''}`}
      disabled={busy || !arena.canTrade}
      onClick={() => onSelect(arena.id)}
    >
      <div className="arena-pick-card__top">
        <span><i />{status}</span>
        <small>{clock}</small>
      </div>
      <strong>{arena.title}</strong>
      <div className="arena-pick-card__meta">
        {arena.rank ? <span>#{arena.rank}</span> : null}
        {typeof pnl === 'number' && (
          <span className={pnlPos ? 'is-profit' : 'is-loss'}>{pnlPos ? '+' : ''}{pnl.toFixed(0)} $</span>
        )}
        <span>{t('terminal.arenaTraders', { count: arena.participants ?? 0 })}</span>
        {current && <em>{t('terminal.arenaCurrent')}</em>}
        {busy && <em>{t('terminal.arenaOpening')}</em>}
        {!arena.canTrade && arena.status !== 'ended' && <em>{t('terminal.arenaLocked')}</em>}
      </div>
    </button>
  )
}

export function ArenaPickerList({
  competitions,
  currentId,
  busyId,
  onSelect,
}: {
  competitions: MyCompetition[]
  currentId?: string
  busyId?: string
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const [now, setNow] = useState(Date.now())
  const visible = useMemo(() => sortArenas(competitions, currentId), [competitions, currentId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (!visible.length) {
    return <div className="arena-pick-empty">{t('terminal.arenaEmpty')}</div>
  }

  return (
    <div className="arena-pick-list">
      {visible.map((arena) => (
        <ArenaCard
          key={arena.id}
          arena={arena}
          current={arena.id === currentId}
          busy={busyId === arena.id}
          now={now}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export function ArenaPickerSheet({
  open,
  competitions,
  currentId,
  busyId,
  onSelect,
  onClose,
}: {
  open: boolean
  competitions: MyCompetition[]
  currentId?: string
  busyId?: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  if (!open) return null
  return createPortal(
    <div className="arena-pick-layer">
      <button className="arena-pick-backdrop" type="button" aria-label={t('common.close')} onClick={onClose} />
      <section className="arena-pick-sheet" role="dialog" aria-modal="true" aria-label={t('terminal.switchArena')}>
        <header>
          <span>{t('terminal.switchArena')}</span>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <ArenaPickerList
          competitions={competitions}
          currentId={currentId}
          busyId={busyId}
          onSelect={onSelect}
        />
      </section>
    </div>,
    document.body,
  )
}
