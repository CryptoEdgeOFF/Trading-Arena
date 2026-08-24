import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import {
  apiAssetUrl,
  blockChatUser,
  getBlockedChatUserIds,
  getGlobalChatMessages,
  globalChatWebSocketUrl,
  reportGlobalChatMessage,
  sendGlobalChatMessage,
  unblockChatUser,
  uploadChatImage,
  type ChatReportReason,
  type GlobalChatMessage,
  type SessionUser,
} from '../lib/api'
import { compressImage } from '../lib/imageCompress'
import { useI18n } from '../i18n'
import './GlobalChat.css'

const REPORT_REASONS: ChatReportReason[] = ['harassment', 'hate', 'spam', 'sexual', 'violence', 'other']

function mergeMessages(current: GlobalChatMessage[], incoming: GlobalChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]))
  for (const message of incoming) {
    if (message.clientId) {
      for (const [id, existing] of byId) {
        if (existing.clientId === message.clientId) byId.delete(id)
      }
    }
    byId.set(message.id, message)
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt).slice(-300)
}

function cacheKey(userId: string, competitionId?: string) {
  return competitionId ? `btf.chat.messages.${userId}.${competitionId}` : `btf.chat.messages.${userId}`
}

function cachedMessages(userId: string, competitionId?: string): GlobalChatMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(userId, competitionId)) || '[]')
    return Array.isArray(parsed) ? parsed.slice(-150) : []
  } catch {
    return []
  }
}

function messageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function replyPreview(message: Pick<GlobalChatMessage, 'body' | 'imageUrl'>, photoLabel: string) {
  return message.body || (message.imageUrl ? photoLabel : '')
}

export function GlobalChat({
  token,
  user,
  onOpenPlayer,
  onLatestSeen,
  onAuth,
  competitionId,
  title,
  onClose,
}: {
  token?: string | null
  user?: SessionUser | null
  onOpenPlayer: (userId: string) => void
  onLatestSeen: (timestamp: number) => void
  onAuth?: () => void
  /** Si fourni, le chat devient la salle de cette arène. */
  competitionId?: string
  title?: string
  onClose?: () => void
}) {
  const { t } = useI18n()
  const viewerId = user?.id || 'guest'
  const initialMessagesRef = useRef(cachedMessages(viewerId, competitionId))
  const [messages, setMessages] = useState<GlobalChatMessage[]>(initialMessagesRef.current)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(initialMessagesRef.current.length === 0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [replyTo, setReplyTo] = useState<GlobalChatMessage | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingPhoto, setPendingPhoto] = useState<{ file: File; previewUrl: string } | null>(null)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set())
  const [actionMessage, setActionMessage] = useState<GlobalChatMessage | null>(null)
  const [reportReason, setReportReason] = useState<ChatReportReason | null>(null)
  const [moderationOpen, setModerationOpen] = useState(false)
  const [moderationBusy, setModerationBusy] = useState(false)
  const [moderationStatus, setModerationStatus] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const initializedRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressOriginRef = useRef({ x: 0, y: 0 })
  const suppressPhotoClickRef = useRef(false)

  const loadLatest = useCallback(async () => {
    try {
      const next = await getGlobalChatMessages(token, undefined, competitionId)
      setMessages((current) => mergeMessages(current, next))
      setError('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Chat indisponible')
    } finally {
      setLoading(false)
    }
  }, [token, competitionId])

  useEffect(() => {
    void loadLatest()
    const poll = window.setInterval(() => void loadLatest(), 12_000)
    return () => window.clearInterval(poll)
  }, [loadLatest])

  useEffect(() => {
    if (!token || !user) {
      setBlockedUserIds(new Set())
      return
    }
    let active = true
    void getBlockedChatUserIds(token)
      .then((ids) => {
        if (active) setBlockedUserIds(new Set(ids))
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [token, user])

  useEffect(() => () => {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
  }, [])

  useEffect(() => {
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let reconnectDelay = 1_000
    const connect = () => {
      if (!active || !token) return
      socket = new WebSocket(globalChatWebSocketUrl(token, competitionId))
      socketRef.current = socket
      socket.onopen = () => { reconnectDelay = 1_000 }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string
            data?: GlobalChatMessage & { error?: string; clientId?: string }
          }
          if (payload.type === 'chat:message' && payload.data) {
            setMessages((current) => mergeMessages(current, [payload.data!]))
          }
          if (payload.type === 'chat:error' && payload.data) {
            setMessages((current) => current.filter((message) => message.clientId !== payload.data?.clientId))
            setError(payload.data.error || 'Envoi impossible')
          }
        } catch {
          // Ignore un malformed frame and keep the connection alive.
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!active) return
        reconnectTimer = window.setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(15_000, reconnectDelay * 2)
      }
    }
    connect()
    return () => {
      active = false
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [token, competitionId])

  useEffect(() => {
    const persisted = messages
      .filter((message) => !message.id.startsWith('temp-') && !message.imageUrl?.startsWith('blob:'))
      .slice(-150)
    window.localStorage.setItem(cacheKey(viewerId, competitionId), JSON.stringify(persisted))
  }, [messages, viewerId, competitionId])

  useEffect(() => {
    if (!messages.length) return
    onLatestSeen(messages.at(-1)!.createdAt)
    if (!initializedRef.current || messages.at(-1)?.userId === viewerId) {
      initializedRef.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, onLatestSeen, viewerId])

  async function loadOlder() {
    const before = messages[0]?.createdAt
    if (!before || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await getGlobalChatMessages(token, before, competitionId)
      setMessages((current) => mergeMessages(older, current))
    } finally {
      setLoadingOlder(false)
    }
  }

  function clearPendingPhoto() {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl)
    setPendingPhoto(null)
  }

  function acceptPickedFile(file?: File | null) {
    if (!file || !file.type.startsWith('image/')) return
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.previewUrl)
    setPendingPhoto({ file, previewUrl: URL.createObjectURL(file) })
  }

  async function pickPhoto(source: 'camera' | 'gallery') {
    setPickerOpen(false)
    try {
      const photo = await Camera.getPhoto({
        quality: 82,
        resultType: CameraResultType.Uri,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
        correctOrientation: true,
        width: 1600,
      })
      if (!photo.webPath) return
      const blob = await (await fetch(photo.webPath)).blob()
      acceptPickedFile(new File([blob], `photo.${photo.format || 'jpg'}`, { type: blob.type || 'image/jpeg' }))
    } catch (error) {
      const cancelled = /cancel/i.test(String((error as Error)?.message || error))
      if (cancelled) return
      if (source === 'camera') cameraInputRef.current?.click()
      else galleryInputRef.current?.click()
    }
  }

  async function send() {
    if (!token || !user) {
      onAuth?.()
      return
    }
    const value = body.trim()
    const photo = pendingPhoto
    if ((!value && !photo) || sending) return
    const clientId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const replyToId = replyTo?.id
    const optimistic: GlobalChatMessage = {
      id: `temp-${clientId}`,
      clientId,
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      body: value,
      imageUrl: photo?.previewUrl || null,
      createdAt: Date.now(),
      replyTo: replyTo ? {
        id: replyTo.id,
        userId: replyTo.userId,
        name: replyTo.name,
        body: replyTo.body,
        imageUrl: replyTo.imageUrl,
      } : null,
    }
    setMessages((current) => mergeMessages(current, [optimistic]))
    setBody('')
    setReplyTo(null)
    setPendingPhoto(null)
    setError('')
    setSending(true)
    try {
      let imageUrl: string | undefined
      if (photo) {
        const compressed = await compressImage(photo.file)
        imageUrl = await uploadChatImage(token, compressed)
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'chat:send',
          data: { body: value, imageUrl, replyToId, clientId },
        }))
      } else {
        const message = await sendGlobalChatMessage(token, value, replyToId, imageUrl, competitionId)
        setMessages((current) => mergeMessages(current.filter((item) => item.clientId !== clientId), [message]))
      }
    } catch (nextError) {
      setMessages((current) => current.filter((message) => message.clientId !== clientId))
      setError(nextError instanceof Error ? nextError.message : 'Envoi impossible')
    } finally {
      setSending(false)
      if (photo) window.setTimeout(() => URL.revokeObjectURL(photo.previewUrl), 8_000)
    }
  }

  function cancelLongPress() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function beginLongPress(event: ReactPointerEvent, message: GlobalChatMessage) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelLongPress()
    longPressOriginRef.current = { x: event.clientX, y: event.clientY }
    longPressTimerRef.current = window.setTimeout(() => {
      suppressPhotoClickRef.current = true
      setReplyTo(message)
      longPressTimerRef.current = null
    }, 520)
  }

  function moveLongPress(event: ReactPointerEvent) {
    const dx = event.clientX - longPressOriginRef.current.x
    const dy = event.clientY - longPressOriginRef.current.y
    if (Math.hypot(dx, dy) > 9) cancelLongPress()
  }

  function scrollToMessage(id: string) {
    document.getElementById(`chat-message-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function openPhoto(url: string) {
    if (suppressPhotoClickRef.current) {
      suppressPhotoClickRef.current = false
      return
    }
    setViewerUrl(url)
  }

  function openPicker() {
    if (Capacitor.isNativePlatform()) void Haptics.impact({ style: ImpactStyle.Light })
    setPickerOpen(true)
  }

  async function blockSelectedUser() {
    if (!token || !actionMessage || actionMessage.userId === user?.id || moderationBusy) return
    if (!window.confirm(t('chat.blockConfirm', { name: actionMessage.name }))) return
    setModerationBusy(true)
    try {
      await blockChatUser(token, actionMessage.userId)
      setBlockedUserIds((current) => new Set([...current, actionMessage.userId]))
      setModerationStatus(t('chat.blocked', { name: actionMessage.name }))
      setActionMessage(null)
      setReportReason(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('chat.moderationError'))
    } finally {
      setModerationBusy(false)
    }
  }

  async function unblockUser(userId: string) {
    if (!token || moderationBusy) return
    setModerationBusy(true)
    try {
      await unblockChatUser(token, userId)
      setBlockedUserIds((current) => {
        const next = new Set(current)
        next.delete(userId)
        return next
      })
      setModerationStatus(t('chat.unblocked'))
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('chat.moderationError'))
    } finally {
      setModerationBusy(false)
    }
  }

  async function submitReport() {
    if (!token || !actionMessage || !reportReason || moderationBusy) return
    setModerationBusy(true)
    try {
      await reportGlobalChatMessage(token, actionMessage.id, reportReason)
      setModerationStatus(t('chat.reportSent'))
      setActionMessage(null)
      setReportReason(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('chat.moderationError'))
    } finally {
      setModerationBusy(false)
    }
  }

  const visibleMessages = useMemo(
    () => messages.filter((message) => !blockedUserIds.has(message.userId)),
    [blockedUserIds, messages],
  )

  const traders = useMemo(() => {
    const seen = new Map<string, GlobalChatMessage>()
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index]
      if (!seen.has(message.userId)) seen.set(message.userId, message)
    }
    return Array.from(seen.values())
  }, [visibleMessages])

  const canSend = Boolean(body.trim() || pendingPhoto) && !sending

  return (
    <div className="global-chat">
      <header className="global-chat__head">
        {onClose && <button className="global-chat__back" type="button" onClick={onClose} aria-label={t('common.close')}>‹</button>}
        <strong>{title || t('chat.title')}</strong>
        <div className="global-chat__people">
          {traders.length > 0 && (
            <div className="global-chat__faces" aria-hidden="true">
              {traders.slice(0, 3).map((trader) => (
                <span key={trader.userId} className="global-chat__face">
                  {trader.avatarUrl ? <img src={apiAssetUrl(trader.avatarUrl)} alt="" /> : trader.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
          )}
          <span>{traders.length ? t('chat.traders', { count: traders.length }) : t('chat.community')}</span>
        </div>
        <button className="global-chat__moderation-button" type="button" onClick={() => setModerationOpen(true)}
          aria-label={t('chat.moderation')} title={t('chat.moderation')}>⚑</button>
      </header>
      <div className="global-chat__notice">{competitionId ? t('chat.arenaNotice') : t('chat.notice')}</div>

      <section className="global-chat__messages" aria-live="polite">
        {visibleMessages.length > 0 && <button className="global-chat__older" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? t('common.loading') : t('chat.older')}</button>}
        {loading ? <div className="global-chat__state">{t('chat.loading')}</div>
          : !visibleMessages.length ? <div className="global-chat__state"><strong>{t('chat.emptyTitle')}</strong><span>{t('chat.emptyLead')}</span></div>
            : visibleMessages.map((message, index) => {
              const mine = Boolean(user && message.userId === user.id)
              const previous = visibleMessages[index - 1]
              const grouped = !message.replyTo && previous?.userId === message.userId && message.createdAt - previous.createdAt < 5 * 60_000
              const imageSrc = message.imageUrl ? apiAssetUrl(message.imageUrl) : ''
              return <article key={message.id} id={`chat-message-${message.id}`}
                className={`${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''} ${message.imageUrl ? 'has-photo' : ''}`}
                onPointerDown={(event) => beginLongPress(event, message)}
                onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress}
                onContextMenu={(event) => event.preventDefault()}>
                {!grouped && <button className="global-chat__avatar" type="button" onClick={() => onOpenPlayer(message.userId)}>
                  {message.avatarUrl ? <img src={apiAssetUrl(message.avatarUrl)} alt="" /> : message.name.slice(0, 2).toUpperCase()}
                </button>}
                <div className={`global-chat__message-content ${message.replyTo ? 'has-reply' : ''} ${message.imageUrl ? 'has-photo' : ''}`}>
                  {!grouped && <header><button type="button" onClick={() => onOpenPlayer(message.userId)}>{message.name}</button><time>{messageTime(message.createdAt)}</time></header>}
                  {message.replyTo && <button className="global-chat__reply-quote" type="button" onClick={() => scrollToMessage(message.replyTo!.id)}>
                    {message.replyTo.imageUrl && <img src={apiAssetUrl(message.replyTo.imageUrl)} alt="" />}
                    <span>
                      <strong>{t('chat.replyTo', { name: message.replyTo.name })}</strong>
                      <small>{replyPreview(message.replyTo, t('chat.photo'))}</small>
                    </span>
                  </button>}
                  {imageSrc && (
                    <button className="global-chat__photo" type="button" onClick={() => openPhoto(imageSrc)}>
                      <img src={imageSrc} alt={t('chat.photo')} />
                    </button>
                  )}
                  {message.body ? <p>{message.body}</p> : null}
                </div>
                {!mine && token && <button className="global-chat__message-actions" type="button"
                  aria-label={t('chat.messageActions')}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    setReportReason(null)
                    setActionMessage(message)
                  }}>•••</button>}
              </article>
            })}
        <div ref={bottomRef} />
      </section>

      {error && <div className="global-chat__error">{error}</div>}
      {moderationStatus && <button className="global-chat__moderation-status" type="button"
        onClick={() => setModerationStatus('')}>{moderationStatus} ×</button>}
      {!token || !user ? (
        <button className="global-chat__guest" type="button" onClick={() => onAuth?.()}>
          {t('chat.loginToWrite')}
        </button>
      ) : (
      <form className={`global-chat__composer ${replyTo ? 'has-reply' : ''}`} onSubmit={(event) => { event.preventDefault(); void send() }}>
        {replyTo && <div className="global-chat__replying">
          {replyTo.imageUrl && <img src={apiAssetUrl(replyTo.imageUrl)} alt="" />}
          <span><strong>{t('chat.replyTo', { name: replyTo.name })}</strong><small>{replyPreview(replyTo, t('chat.photo'))}</small></span>
          <button type="button" onClick={() => setReplyTo(null)} aria-label={t('chat.cancelReply')}>×</button>
        </div>}
        <button className="global-chat__attach" type="button" onClick={openPicker} aria-label={t('chat.attach')}>+</button>
        <input ref={galleryInputRef} hidden type="file" accept="image/*" onChange={(event) => {
          acceptPickedFile(event.target.files?.[0])
          event.target.value = ''
        }} />
        <input ref={cameraInputRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => {
          acceptPickedFile(event.target.files?.[0])
          event.target.value = ''
        }} />
        <textarea value={body} maxLength={600} rows={1} placeholder={t('chat.placeholder')}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }} />
        <button type="submit" disabled={!canSend} aria-label={t('common.send')}>➤</button>
      </form>
      )}

      {pickerOpen && (
        <div className="global-chat__sheet" onClick={() => setPickerOpen(false)}>
          <div className="global-chat__sheet-card" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => void pickPhoto('camera')}>{t('chat.takePhoto')}</button>
            <button type="button" onClick={() => void pickPhoto('gallery')}>{t('chat.chooseGallery')}</button>
            <button type="button" className="is-cancel" onClick={() => setPickerOpen(false)}>{t('common.close')}</button>
          </div>
        </div>
      )}

      {actionMessage && (
        <div className="global-chat__sheet" onClick={() => { setActionMessage(null); setReportReason(null) }}>
          <div className="global-chat__sheet-card global-chat__moderation-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="global-chat__sheet-title">
              <strong>{actionMessage.name}</strong>
              <small>{t('chat.moderationSafe')}</small>
            </div>
            {!reportReason ? (
              <>
                <button type="button" onClick={() => {
                  setReplyTo(actionMessage)
                  setActionMessage(null)
                }}>{t('chat.reply')}</button>
                <button type="button" className="is-danger" onClick={() => setReportReason('harassment')}>
                  {t('chat.report')}
                </button>
                <button type="button" className="is-danger" disabled={moderationBusy} onClick={() => void blockSelectedUser()}>
                  {t('chat.blockUser', { name: actionMessage.name })}
                </button>
              </>
            ) : (
              <>
                <div className="global-chat__report-reasons" role="group" aria-label={t('chat.reportReason')}>
                  {REPORT_REASONS.map((reason) => (
                    <button key={reason} type="button" className={reportReason === reason ? 'is-selected' : ''}
                      onClick={() => setReportReason(reason)}>{t(`chat.reportReasons.${reason}`)}</button>
                  ))}
                </div>
                <button type="button" className="is-danger" disabled={!reportReason || moderationBusy}
                  onClick={() => void submitReport()}>{moderationBusy ? t('common.loading') : t('chat.sendReport')}</button>
                <button type="button" onClick={() => setReportReason(null)}>{t('common.back')}</button>
              </>
            )}
            <button type="button" className="is-cancel" onClick={() => {
              setActionMessage(null)
              setReportReason(null)
            }}>{t('common.close')}</button>
          </div>
        </div>
      )}

      {moderationOpen && (
        <div className="global-chat__sheet" onClick={() => setModerationOpen(false)}>
          <div className="global-chat__sheet-card global-chat__moderation-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="global-chat__sheet-title">
              <strong>{t('chat.moderation')}</strong>
              <small>{t('chat.moderationLead')}</small>
            </div>
            <a className="global-chat__contact" href="mailto:contact.cryptoedge@gmail.com?subject=Modération%20du%20chat%20BTF">
              {t('chat.contactModeration')}
            </a>
            <div className="global-chat__blocked-list">
              <strong>{t('chat.blockedUsers', { count: blockedUserIds.size })}</strong>
              {Array.from(blockedUserIds).map((blockedId) => {
                const blockedMessage = messages.find((message) => message.userId === blockedId)
                return <div key={blockedId}>
                  <span>{blockedMessage?.name || t('chat.blockedUser')}</span>
                  <button type="button" disabled={moderationBusy} onClick={() => void unblockUser(blockedId)}>
                    {t('chat.unblock')}
                  </button>
                </div>
              })}
            </div>
            <button type="button" className="is-cancel" onClick={() => setModerationOpen(false)}>{t('common.close')}</button>
          </div>
        </div>
      )}

      {pendingPhoto && (
        <div className="global-chat__preview">
          <button className="global-chat__preview-close" type="button" onClick={clearPendingPhoto} aria-label={t('chat.removePhoto')}>×</button>
          <img src={pendingPhoto.previewUrl} alt={t('chat.photo')} />
          <form className="global-chat__preview-bar" onSubmit={(event) => { event.preventDefault(); void send() }}>
            <textarea value={body} maxLength={600} rows={1} placeholder={t('chat.captionPlaceholder')}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send()
                }
              }} />
            <button type="submit" disabled={sending} aria-label={t('common.send')}>{sending ? '…' : '➤'}</button>
          </form>
        </div>
      )}

      {viewerUrl && (
        <button className="global-chat__lightbox" type="button" onClick={() => setViewerUrl(null)} aria-label={t('chat.closePhoto')}>
          <img src={viewerUrl} alt={t('chat.photo')} />
        </button>
      )}
    </div>
  )
}
