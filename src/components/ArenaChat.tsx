import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AvatarImage } from './OptimizedImage';
import { resolveMediaUrl } from '../utils/imageUrl';
import { getWebSocketUrl } from '../lib/runtimeApi';
import {
  COMPETE_SESSION_KEY,
  readCachedCompeteUser,
  type CompeteSessionUser,
} from '../lib/competeSession';
import { useIsMobileWeb } from '../lib/mobileWeb';
import './ArenaChat.css';

type ArenaChatReply = {
  id: string;
  userId: string;
  name: string;
  body: string;
  imageUrl: string | null;
};

type ArenaChatMessage = {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  imageUrl: string | null;
  createdAt: number;
  replyTo?: ArenaChatReply | null;
};

function mergeMessages(current: ArenaChatMessage[], incoming: ArenaChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  const next = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
  if (
    next.length === current.length
    && next.every((message, index) => (
      message.id === current[index].id
      && message.body === current[index].body
      && message.imageUrl === current[index].imageUrl
      && message.replyTo?.id === current[index].replyTo?.id
    ))
  ) {
    return current;
  }
  return next;
}

function replyPreview(message: Pick<ArenaChatReply, 'body' | 'imageUrl'>, photoLabel: string) {
  return message.body || (message.imageUrl ? photoLabel : '');
}

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 96;
}

function ReplyGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 17l-5-5 5-5" />
      <path d="M4 12h11a5 5 0 0 1 5 5v1" />
    </svg>
  );
}

function lastSeenKey(competitionId: string, userId?: string | null) {
  return `btf.arenaChat.lastSeen.${userId || 'guest'}.${competitionId}`;
}

function readLastSeen(competitionId: string, userId?: string | null): number | null {
  const raw = window.localStorage.getItem(lastSeenKey(competitionId, userId));
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function writeLastSeen(competitionId: string, userId: string | null | undefined, timestamp: number) {
  window.localStorage.setItem(lastSeenKey(competitionId, userId), String(timestamp));
}

function UnreadBubble({ count }: { count: number }) {
  if (count <= 0) return null;
  return <b className="arena-chat-unread">{count > 99 ? '99+' : count}</b>;
}

export default function ArenaChat({
  competitionId,
  title,
}: {
  competitionId: string;
  title: string;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isMobileWeb = useIsMobileWeb();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ArenaChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [viewer, setViewer] = useState('');
  const [replyTo, setReplyTo] = useState<ArenaChatMessage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const stickToBottomRef = useRef(true);
  const primedSeenRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const token = window.localStorage.getItem(COMPETE_SESSION_KEY);
  const user = readCachedCompeteUser() as CompeteSessionUser | null;
  const [lastSeen, setLastSeen] = useState<number | null>(() => readLastSeen(competitionId, user?.id));

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/competition/chat/messages?competitionId=${encodeURIComponent(competitionId)}`);
      const payload = await response.json() as { messages?: ArenaChatMessage[]; error?: string };
      if (!response.ok) throw new Error(payload.error || t('arenaChat.unavailable'));
      setMessages((current) => mergeMessages(current, payload.messages || []));
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('arenaChat.unavailable'));
    } finally {
      setLoading(false);
    }
  }, [competitionId, t]);

  useEffect(() => {
    primedSeenRef.current = false;
    setReplyTo(null);
    setLastSeen(readLastSeen(competitionId, user?.id));
  }, [competitionId, user?.id]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), open ? 30_000 : 45_000);
    return () => window.clearInterval(timer);
  }, [load, open]);

  useEffect(() => {
    if (!messages.length) return;
    const latest = messages[messages.length - 1].createdAt;
    if (lastSeen == null && !primedSeenRef.current) {
      primedSeenRef.current = true;
      writeLastSeen(competitionId, user?.id, latest);
      setLastSeen(latest);
      return;
    }
    if (!open) return;
    if (lastSeen == null || latest > lastSeen) {
      writeLastSeen(competitionId, user?.id, latest);
      setLastSeen(latest);
    }
  }, [competitionId, lastSeen, messages, open, user?.id]);

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectDelay = 1_000;
    const connect = () => {
      if (!active) return;
      const wsUrl = new URL(getWebSocketUrl('/ws/chat'));
      wsUrl.searchParams.set('token', token);
      wsUrl.searchParams.set('competitionId', competitionId);
      socket = new WebSocket(wsUrl.toString());
      socket.onopen = () => { reconnectDelay = 1_000; };
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { type?: string; data?: ArenaChatMessage };
          if (payload.type === 'chat:message' && payload.data) {
            setMessages((current) => mergeMessages(current, [payload.data!]));
          }
        } catch {
          // Le polling REST reste disponible en secours.
        }
      };
      socket.onclose = () => {
        if (!active) return;
        reconnectTimer = window.setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
      };
    };
    connect();
    return () => {
      active = false;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [competitionId, open, token]);

  useEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open]);

  useEffect(() => {
    if (!open || !stickToBottomRef.current) return;
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  function startReply(message: ArenaChatMessage) {
    if (!token || !user) {
      navigate('/compete#signup');
      return;
    }
    setReplyTo(message);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function cancelLongPress() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function beginLongPress(event: ReactPointerEvent, message: ArenaChatMessage) {
    if (!isMobileWeb) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    cancelLongPress();
    longPressOriginRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      startReply(message);
      longPressTimerRef.current = null;
    }, 520);
  }

  function moveLongPress(event: ReactPointerEvent) {
    const dx = event.clientX - longPressOriginRef.current.x;
    const dy = event.clientY - longPressOriginRef.current.y;
    if (Math.hypot(dx, dy) > 9) cancelLongPress();
  }

  function scrollToQuoted(id: string) {
    const list = listRef.current;
    const target = list?.querySelector(`#arena-chat-${id}`);
    if (!list || !(target instanceof HTMLElement)) return;
    const top = target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    list.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' });
  }

  function choosePhoto(file?: File | null) {
    if (!file?.type.startsWith('image/')) return;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(null);
    setPreview('');
  }

  async function send() {
    if (!token || !user) {
      navigate('/compete#signup');
      return;
    }
    const text = body.trim();
    if ((!text && !photo) || sending) return;
    setSending(true);
    setError('');
    try {
      let imageUrl: string | undefined;
      if (photo) {
        const form = new FormData();
        form.append('image', photo);
        const upload = await fetch('/api/competition/chat/images', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const uploadPayload = await upload.json() as { imageUrl?: string; error?: string };
        if (!upload.ok || !uploadPayload.imageUrl) throw new Error(uploadPayload.error || t('arenaChat.uploadFailed'));
        imageUrl = uploadPayload.imageUrl;
      }
      const response = await fetch('/api/competition/chat/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ competitionId, body: text, imageUrl, replyToId: replyTo?.id }),
      });
      const payload = await response.json() as { message?: ArenaChatMessage; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error || t('arenaChat.sendFailed'));
      stickToBottomRef.current = true;
      setMessages((current) => mergeMessages(current, [payload.message!]));
      setBody('');
      setReplyTo(null);
      clearPhoto();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('arenaChat.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  const panel = (
    <aside className={`arena-chat-panel${isMobileWeb ? '' : ' is-float'}`}>
      <header>
        <div>
          <span>{t('arenaChat.kicker')}</span>
          <strong>{title}</strong>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label={isMobileWeb ? t('common.close') : t('arenaChat.collapse')}>
          {isMobileWeb ? '×' : '–'}
        </button>
      </header>
      <div className="arena-chat-notice">{isMobileWeb ? t('arenaChat.noticeMobile') : t('arenaChat.notice')}</div>

      <section
        ref={listRef}
        className="arena-chat-messages"
        aria-live="polite"
        onScroll={() => {
          const el = listRef.current;
          if (el) stickToBottomRef.current = isNearBottom(el);
        }}
      >
        {loading ? (
          <div className="arena-chat-state">{t('common.loading')}</div>
        ) : messages.length === 0 ? (
          <div className="arena-chat-state">
            <strong>{t('arenaChat.emptyTitle')}</strong>
            <span>{t('arenaChat.emptyLead')}</span>
          </div>
        ) : messages.map((message) => {
          const mine = user?.id === message.userId;
          return (
            <article
              key={message.id}
              id={`arena-chat-${message.id}`}
              className={mine ? 'is-mine' : ''}
              onPointerDown={(event) => beginLongPress(event, message)}
              onPointerMove={moveLongPress}
              onPointerUp={cancelLongPress}
              onPointerCancel={cancelLongPress}
              onContextMenu={(event) => {
                if (isMobileWeb) event.preventDefault();
              }}
            >
              <button type="button" onClick={() => navigate(`/compete/player/${message.userId}`)}>
                {message.avatarUrl
                  ? <AvatarImage src={message.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" sizePx={32} />
                  : <span>{message.name.slice(0, 2).toUpperCase()}</span>}
              </button>
              <div>
                {!isMobileWeb && (
                  <button
                    type="button"
                    className="arena-chat-reply-btn"
                    onClick={() => startReply(message)}
                    aria-label={t('arenaChat.reply')}
                    title={t('arenaChat.reply')}
                  >
                    <ReplyGlyph />
                  </button>
                )}
                <header>
                  <strong>{message.name}</strong>
                  <time>{new Date(message.createdAt).toLocaleTimeString(i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</time>
                </header>
                {message.replyTo && (
                  <button
                    className="arena-chat-quote"
                    type="button"
                    onClick={() => scrollToQuoted(message.replyTo!.id)}
                  >
                    <strong>{t('arenaChat.replyTo', { name: message.replyTo.name })}</strong>
                    <small>{replyPreview(message.replyTo, t('arenaChat.photo'))}</small>
                  </button>
                )}
                {message.imageUrl && (
                  <button
                    className="arena-chat-photo"
                    type="button"
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setViewer(resolveMediaUrl(message.imageUrl) || message.imageUrl || '');
                    }}
                  >
                    <img src={resolveMediaUrl(message.imageUrl)} alt={t('arenaChat.photo')} />
                  </button>
                )}
                {message.body && <p>{message.body}</p>}
              </div>
            </article>
          );
        })}
      </section>

      {error && <div className="arena-chat-error">{error}</div>}
      {!token || !user ? (
        <button className="arena-chat-login" type="button" onClick={() => navigate('/compete#signup')}>
          {t('arenaChat.loginToWrite')}
        </button>
      ) : (
        <form className={replyTo ? 'has-reply' : ''} onSubmit={(event) => { event.preventDefault(); void send(); }}>
          {replyTo && (
            <div className="arena-chat-replying">
              <span>
                <strong>{t('arenaChat.replyTo', { name: replyTo.name })}</strong>
                <small>{replyPreview(replyTo, t('arenaChat.photo'))}</small>
              </span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label={t('arenaChat.cancelReply')}>×</button>
            </div>
          )}
          {preview && (
            <div className="arena-chat-preview">
              <img src={preview} alt="" />
              <button type="button" onClick={clearPhoto}>×</button>
            </div>
          )}
          <div className="arena-chat-composer">
            <button type="button" onClick={() => inputRef.current?.click()} aria-label={t('arenaChat.attach')}>＋</button>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept="image/*"
              onChange={(event) => {
                choosePhoto(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              maxLength={600}
              value={body}
              placeholder={replyTo ? t('arenaChat.replyTo', { name: replyTo.name }) : t('arenaChat.placeholder')}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" disabled={sending || (!body.trim() && !photo)}>{sending ? '…' : '➤'}</button>
          </div>
        </form>
      )}
    </aside>
  );

  const unread = open || lastSeen == null
    ? 0
    : messages.filter((message) => message.createdAt > lastSeen && message.userId !== user?.id).length;

  return (
    <>
      {isMobileWeb && (
        <button
          type="button"
          className="arena-chat-btn"
          onClick={() => setOpen(true)}
          aria-label={unread > 0 ? t('arenaChat.unread', { count: unread }) : t('arenaChat.open')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
          </svg>
          <span className="arena-chat-btn__label">Chat</span>
          <UnreadBubble count={unread} />
        </button>
      )}
      {createPortal(
        <>
          {isMobileWeb ? (
            open ? (
              <div className="arena-chat-backdrop" onMouseDown={() => setOpen(false)}>
                <div onMouseDown={(event) => event.stopPropagation()}>{panel}</div>
              </div>
            ) : null
          ) : (
            <div className={`arena-chat-dock${open ? ' is-open' : ''}`}>
              {!open && (
                <button
                  type="button"
                  className="arena-chat-tab"
                  onClick={() => setOpen(true)}
                  aria-expanded={false}
                  aria-label={unread > 0 ? t('arenaChat.unread', { count: unread }) : t('arenaChat.open')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8 8 0 1 1 21 12Z" />
                  </svg>
                  <span>{t('arenaChat.tab')}</span>
                  <UnreadBubble count={unread} />
                </button>
              )}
              {open && panel}
            </div>
          )}
          {viewer && (
            <button className="arena-chat-lightbox" type="button" onClick={() => setViewer('')}>
              <img src={viewer} alt={t('arenaChat.photo')} />
            </button>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
