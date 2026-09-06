import { useEffect, useRef } from 'react'
import type { PaperTrade } from '../lib/api'
import {
  playTradeCloseSound,
  preloadTerminalSounds,
  unlockTerminalSounds,
} from '../lib/terminalSounds'

export function useTerminalTradeSounds(trades: PaperTrade[] | null | undefined): void {
  const seenIdsRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)

  useEffect(() => {
    preloadTerminalSounds()
    const unlock = () => unlockTerminalSounds()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchstart', unlock, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
  }, [])

  useEffect(() => {
    const list = trades || []
    if (!seededRef.current) {
      for (const trade of list) seenIdsRef.current.add(trade.id)
      seededRef.current = true
      return
    }
    for (const trade of list) {
      if (trade.action !== 'close' || seenIdsRef.current.has(trade.id)) continue
      seenIdsRef.current.add(trade.id)
      playTradeCloseSound(trade.pnl)
    }
  }, [trades])
}
