import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  apiAssetUrl,
  getGlobalChatMessages,
  globalChatWebSocketUrl,
  sendGlobalChatMessage,
  type GlobalChatMessage,
  type SessionUser,
} from '../lib/api'
import './GlobalChat.css'

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

function cachedMessages(userId: string): GlobalChatMessage[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`btf.chat.messages.${userId}`) || '[]')
    return Array.isArray(parsed) ? parsed.slice(-150) : []
  } catch {
    return []
  }
}

function messageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function GlobalChat({
  token,
  user,
  onOpenPlayer,
  onLatestSeen,
}: {
  token: string
  user: SessionUser
  onOpenPlayer: (userId: string) => void
  onLatestSeen: (timestamp: number) => void
}) {
  const initialMessagesRef = useRef(cachedMessages(user.id))
  const [messages, setMessages] = useState<GlobalChatMessage[]>(initialMessagesRef.current)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(initialMessagesRef.current.length === 0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const [replyTo, setReplyTo] = useState<GlobalChatMessage | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const initializedRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressOriginRef = useRef({ x: 0, y: 0 })

  const loadLatest = useCallback(async () => {
    try {
      const next = await getGlobalChatMessages(token)
      setMessages((current) => mergeMessages(current, next))
      setError('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Chat indisponible')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadLatest()
    const poll = window.setInterval(() => void loadLatest(), 12_000)
    return () => window.clearInterval(poll)
  }, [loadLatest])

  useEffect(() => () => {
    if (longPressTimerRef.current != null) window.clearTimeout(longPressTimerRef.current)
  }, [])

  useEffect(() => {
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let reconnectDelay = 1_000
    const connect = () => {
      if (!active) return
      socket = new WebSocket(globalChatWebSocketUrl(token))
      socketRef.current = socket
      socket.onopen = () => { reconnectDelay = 1_000 }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as {
            type?: string
            data?: GlobalChatMessage & { error?: string; clientId?: string }
          }
          if (payload.type === 'chat:ready') setOnline(true)
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
        setOnline(false)
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
  }, [token])

  useEffect(() => {
    const persisted = messages.filter((message) => !message.id.startsWith('temp-')).slice(-150)
    window.localStorage.setItem(`btf.chat.messages.${user.id}`, JSON.stringify(persisted))
  }, [messages, user.id])

  useEffect(() => {
    if (!messages.length) return
    onLatestSeen(messages.at(-1)!.createdAt)
    if (!initializedRef.current || messages.at(-1)?.userId === user.id) {
      initializedRef.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, onLatestSeen, user.id])

  async function loadOlder() {
    const before = messages[0]?.createdAt
    if (!before || loadingOlder) return
    setLoadingOlder(true)
    try {
      const older = await getGlobalChatMessages(token, before)
      setMessages((current) => mergeMessages(older, current))
    } finally {
      setLoadingOlder(false)
    }
  }

  async function send() {
    const value = body.trim()
    if (!value || sending) return
    const clientId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: GlobalChatMessage = {
      id: `temp-${clientId}`,
      clientId,
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      body: value,
      createdAt: Date.now(),
      replyTo: replyTo ? { id: replyTo.id, userId: replyTo.userId, name: replyTo.name, body: replyTo.body } : null,
    }
    setMessages((current) => mergeMessages(current, [optimistic]))
    setBody('')
    setReplyTo(null)
    setError('')
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'chat:send',
        data: { body: value, replyToId: replyTo?.id, clientId },
      }))
      return
    }
    setSending(true)
    try {
      const message = await sendGlobalChatMessage(token, value, replyTo?.id)
      setMessages((current) => mergeMessages(current.filter((item) => item.clientId !== clientId), [message]))
    } catch (nextError) {
      setMessages((current) => current.filter((message) => message.clientId !== clientId))
      setError(nextError instanceof Error ? nextError.message : 'Envoi impossible')
    } finally {
      setSending(false)
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

  return (
    <div className="global-chat">
      <header className="global-chat__head">
        <div><small>COMMUNAUTÉ BTF</small><h2>Chat global</h2></div>
        <span className={online ? 'is-online' : ''}><i />{online ? 'En direct' : 'Reconnexion'}</span>
      </header>

      <div className="global-chat__notice">
        Appui long sur un message pour répondre · Aucun message ne constitue un conseil financier.
      </div>

      <section className="global-chat__messages" aria-live="polite">
        {messages.length > 0 && <button className="global-chat__older" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Chargement…' : 'Voir les messages précédents'}</button>}
        {loading ? <div className="global-chat__state">Chargement de la communauté…</div>
          : !messages.length ? <div className="global-chat__state"><strong>Lance la discussion</strong><span>Partage ta première idée avec les traders BTF.</span></div>
            : messages.map((message, index) => {
              const mine = message.userId === user.id
              const previous = messages[index - 1]
              const grouped = !message.replyTo && previous?.userId === message.userId && message.createdAt - previous.createdAt < 5 * 60_000
              return <article key={message.id} id={`chat-message-${message.id}`}
                className={`${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}`}
                onPointerDown={(event) => beginLongPress(event, message)}
                onPointerMove={moveLongPress} onPointerUp={cancelLongPress} onPointerCancel={cancelLongPress}
                onContextMenu={(event) => event.preventDefault()}>
                {!grouped && <button className="global-chat__avatar" type="button" onClick={() => onOpenPlayer(message.userId)}>
                  {message.avatarUrl ? <img src={apiAssetUrl(message.avatarUrl)} alt="" /> : message.name.slice(0, 2).toUpperCase()}
                </button>}
                <div>
                  {!grouped && <header><button type="button" onClick={() => onOpenPlayer(message.userId)}>{message.name}</button><time>{messageTime(message.createdAt)}</time></header>}
                  {message.replyTo && <button className="global-chat__reply-quote" type="button" onClick={() => scrollToMessage(message.replyTo!.id)}>
                    <strong>↩ {message.replyTo.name}</strong><span>{message.replyTo.body}</span>
                  </button>}
                  <p>{message.body}</p>
                </div>
              </article>
            })}
        <div ref={bottomRef} />
      </section>

      {error && <div className="global-chat__error">{error}</div>}
      <form className={`global-chat__composer ${replyTo ? 'has-reply' : ''}`} onSubmit={(event) => { event.preventDefault(); void send() }}>
        {replyTo && <div className="global-chat__replying">
          <span><strong>Réponse à {replyTo.name}</strong><small>{replyTo.body}</small></span>
          <button type="button" onClick={() => setReplyTo(null)} aria-label="Annuler la réponse">×</button>
        </div>}
        <div className="global-chat__composer-avatar">
          {user.avatarUrl ? <img src={apiAssetUrl(user.avatarUrl)} alt="" /> : user.name.slice(0, 2).toUpperCase()}
        </div>
        <textarea value={body} maxLength={600} rows={1} placeholder="Partage une idée…"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }} />
        <button type="submit" disabled={!body.trim() || sending} aria-label="Envoyer">➤</button>
      </form>
    </div>
  )
}
