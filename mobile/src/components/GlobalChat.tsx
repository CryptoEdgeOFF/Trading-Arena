import { useCallback, useEffect, useRef, useState } from 'react'
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
  for (const message of incoming) byId.set(message.id, message)
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt).slice(-300)
}

function messageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function GlobalChat({
  token,
  user,
  onOpenPlayer,
}: {
  token: string
  user: SessionUser
  onOpenPlayer: (userId: string) => void
}) {
  const [messages, setMessages] = useState<GlobalChatMessage[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [online, setOnline] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)

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

  useEffect(() => {
    let active = true
    let socket: WebSocket | null = null
    let reconnectTimer = 0
    let reconnectDelay = 1_000
    const connect = () => {
      if (!active) return
      socket = new WebSocket(globalChatWebSocketUrl(token))
      socket.onopen = () => { reconnectDelay = 1_000 }
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; data?: GlobalChatMessage }
          if (payload.type === 'chat:ready') setOnline(true)
          if (payload.type === 'chat:message' && payload.data) {
            setMessages((current) => mergeMessages(current, [payload.data!]))
          }
        } catch {
          // Ignore un malformed frame and keep the connection alive.
        }
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
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
    if (!messages.length) return
    if (!initializedRef.current || messages.at(-1)?.userId === user.id) {
      initializedRef.current = true
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, user.id])

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
    setSending(true)
    setError('')
    try {
      const message = await sendGlobalChatMessage(token, value)
      setMessages((current) => mergeMessages(current, [message]))
      setBody('')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Envoi impossible')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="global-chat">
      <header className="global-chat__head">
        <div><small>COMMUNAUTÉ BTF</small><h2>Chat global</h2></div>
        <span className={online ? 'is-online' : ''}><i />{online ? 'En direct' : 'Reconnexion'}</span>
      </header>

      <div className="global-chat__notice">
        Partage tes analyses avec respect. Les messages ne constituent pas des conseils financiers.
      </div>

      <section className="global-chat__messages" aria-live="polite">
        {messages.length > 0 && <button className="global-chat__older" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Chargement…' : 'Voir les messages précédents'}</button>}
        {loading ? <div className="global-chat__state">Chargement de la communauté…</div>
          : !messages.length ? <div className="global-chat__state"><strong>Lance la discussion</strong><span>Partage ta première idée avec les traders BTF.</span></div>
            : messages.map((message, index) => {
              const mine = message.userId === user.id
              const previous = messages[index - 1]
              const grouped = previous?.userId === message.userId && message.createdAt - previous.createdAt < 5 * 60_000
              return <article key={message.id} className={`${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}`}>
                {!grouped && <button className="global-chat__avatar" type="button" onClick={() => onOpenPlayer(message.userId)}>
                  {message.avatarUrl ? <img src={apiAssetUrl(message.avatarUrl)} alt="" /> : message.name.slice(0, 2).toUpperCase()}
                </button>}
                <div>
                  {!grouped && <header><button type="button" onClick={() => onOpenPlayer(message.userId)}>{message.name}</button><time>{messageTime(message.createdAt)}</time></header>}
                  <p>{message.body}</p>
                </div>
              </article>
            })}
        <div ref={bottomRef} />
      </section>

      {error && <div className="global-chat__error">{error}</div>}
      <form className="global-chat__composer" onSubmit={(event) => { event.preventDefault(); void send() }}>
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
