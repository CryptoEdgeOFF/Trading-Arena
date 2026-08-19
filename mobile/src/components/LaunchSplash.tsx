import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { useI18n } from '../i18n'
import './LaunchSplash.css'

const VIDEO_SRC = '/assets/Application/splashvideo.mp4'

export function LaunchSplash({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const finished = useRef(false)
  const [leaving, setLeaving] = useState(false)

  function finish() {
    if (finished.current) return
    finished.current = true
    setLeaving(true)
    window.setTimeout(onDone, 380)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let cancelled = false
    const failSafe = window.setTimeout(() => {
      if (!cancelled) finish()
    }, 12_000)

    async function start() {
      const player = videoRef.current
      if (!player) return
      try {
        player.muted = true
        player.playsInline = true
        await player.play()
        if (Capacitor.isNativePlatform()) {
          player.muted = false
        }
      } catch {
        try {
          player.muted = true
          await player.play()
        } catch {
          finish()
        }
      }
      if (Capacitor.isNativePlatform()) {
        await SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => undefined)
      }
    }

    void start()
    return () => {
      cancelled = true
      window.clearTimeout(failSafe)
    }
  }, [])

  return createPortal(
    <div className={`launch-splash ${leaving ? 'is-leaving' : ''}`} onClick={finish}>
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={finish}
        onError={finish}
      />
      <button type="button" className="launch-splash__skip" onClick={(event) => { event.stopPropagation(); finish() }}>
        {t('common.skip')}
      </button>
    </div>,
    document.body,
  )
}
