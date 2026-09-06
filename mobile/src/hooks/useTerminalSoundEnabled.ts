import { useEffect, useState } from 'react'
import {
  isTerminalSoundEnabled,
  setTerminalSoundEnabled,
  subscribeTerminalSoundEnabled,
} from '../lib/terminalSounds'

export function useTerminalSoundEnabled(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(isTerminalSoundEnabled)
  useEffect(() => subscribeTerminalSoundEnabled(setEnabled), [])
  return [enabled, setTerminalSoundEnabled]
}
