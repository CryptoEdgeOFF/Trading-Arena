import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AvatarImage } from './OptimizedImage';
import { resolveMediaUrl } from '../utils/imageUrl';
import {
  COMPETE_SESSION_KEY,
  readCachedCompeteUser,
  type CompeteSessionUser,
} from '../lib/competeSession';
import './ArenaChat.css';

type ArenaChatMessage = {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  body: string;
  imageUrl: string | null;
  createdAt: number;
};

function mergeMessages(current: ArenaChatMessage[], incoming: ArenaChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-200);
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
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ArenaChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [viewer, setViewer] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const token = window.localStorage.getItem(COMPETE_SESSION_KEY);
  const user = readCachedCompeteUser() as CompeteSessionUser | null;

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
    if (!open) return;
    setLoading(messages.length === 0);
    void load();
    const timer = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(timer);
  }, [load, messages.length, open]);

  useEffect(() => {
    if (!open || !token) return;
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let reconnectDelay = 1_000;
    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(
        `${protocol}//${window.location.host}/ws/chat?token=${encodeURIComponent(token)}&competitionId=${encodeURIComponent(competitionId)}`,
      );
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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

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
        body: JSON.stringify({ competitionId, body: text, imageUrl }),
      });
      const payload = await response.json() as { message?: ArenaChatMessage; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error || t('arenaChat.sendFailed'));
      setMessages((current) => mergeMessages(current, [payload.message!]));
      setBody('');
      clearPhoto();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t('arenaChat.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <>
      <button
        type="button"
        className="arena-chat-fab"
        onClick={() => setOpen(true)}
        aria-label={t('arenaChat.open')}
      >
        <span>💬</span>
        <strong>{t('arenaChat.open')}</strong>
        {messages.length > 0 && <em>{messages.length}</em>}
      </button>

      {open && (
        <div className="arena-chat-backdrop" onMouseDown={() => setOpen(false)}>
          <aside className="arena-chat-panel" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>{t('arenaChat.kicker')}</span>
                <strong>{title}</strong>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('common.close')}>×</button>
            </header>
            <div className="arena-chat-notice">{t('arenaChat.notice')}</div>

            <section className="arena-chat-messages" aria-live="polite">
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
                  <article key={message.id} className={mine ? 'is-mine' : ''}>
                    <button type="button" onClick={() => navigate(`/compete/player/${message.userId}`)}>
                      {message.avatarUrl
                        ? <AvatarImage src={message.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" sizePx={32} />
                        : <span>{message.name.slice(0, 2).toUpperCase()}</span>}
                    </button>
                    <div>
                      <header>
                        <strong>{message.name}</strong>
                        <time>{new Date(message.createdAt).toLocaleTimeString(i18n.resolvedLanguage === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</time>
                      </header>
                      {message.imageUrl && (
                        <button className="arena-chat-photo" type="button" onClick={() => setViewer(resolveMediaUrl(message.imageUrl) || message.imageUrl)}>
                          <img src={resolveMediaUrl(message.imageUrl)} alt={t('arenaChat.photo')} />
                        </button>
                      )}
                      {message.body && <p>{message.body}</p>}
                    </div>
                  </article>
                );
              })}
              <div ref={bottomRef} />
            </section>

            {error && <div className="arena-chat-error">{error}</div>}
            {!token || !user ? (
              <button className="arena-chat-login" type="button" onClick={() => navigate('/compete#signup')}>
                {t('arenaChat.loginToWrite')}
              </button>
            ) : (
              <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
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
                    rows={1}
                    maxLength={600}
                    value={body}
                    placeholder={t('arenaChat.placeholder')}
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
        </div>
      )}

      {viewer && (
        <button className="arena-chat-lightbox" type="button" onClick={() => setViewer('')}>
          <img src={viewer} alt={t('arenaChat.photo')} />
        </button>
      )}
    </>,
    document.body,
  );
}
