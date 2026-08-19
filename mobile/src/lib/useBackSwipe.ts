import { useEffect, useRef } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

const EDGE = 28
const THRESHOLD = 68

/** Swipe depuis le bord gauche, comme le retour natif iPhone. */
export function useBackSwipe(onBack: (() => void) | null) {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!onBack) return

    let startX = 0
    let startY = 0
    let tracking = false

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || touch.clientX > EDGE) return
      tracking = true
      startX = touch.clientX
      startY = touch.clientY
    }

    const onMove = (event: TouchEvent) => {
      if (!tracking) return
      const touch = event.touches[0]
      if (!touch) return
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) {
        tracking = false
        return
      }
      if (dx >= THRESHOLD) {
        tracking = false
        onBackRef.current?.()
      }
    }

    const onEnd = () => {
      tracking = false
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)

    let removeApp: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void App.addListener('backButton', () => {
        onBackRef.current?.()
      }).then((handle) => {
        removeApp = () => {
          void handle.remove()
        }
      })
    }

    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
      removeApp?.()
    }
  }, [Boolean(onBack)])
}
