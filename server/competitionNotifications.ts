import type { CashPrize, CompetitionManager } from './competitionManager.js';
import { isMailerConfigured, sendNewArenaEmail, sendNotificationEmail, sendPrizeWinnerEmail } from './mailer.js';
import { getEmailSettings } from './emailSettingsStore.js';

/**
 * Moteur de notifications email des arènes online :
 *  1. « Ton arène démarre bientôt » — envoyé une fois, dans l'heure qui
 *     précède le départ, à tous les inscrits.
 *  2. « Tu as perdu ta place sur le podium » — pendant le live, quand un
 *     joueur sort du top 3 (cooldown anti-spam par joueur).
 *  3. « Résultats de l'arène » — envoyé une fois à la fin, avec le rang et le
 *     PnL final de chaque participant.
 *
 * Les flags « déjà envoyé » des notifications 1 et 3 sont persistés sur la
 * compétition (notifiedStartSoonAt / notifiedEndedAt) pour survivre aux
 * redémarrages. Le suivi du podium est en mémoire : après un restart, le
 * premier tick reconstruit la photo du top 3 sans notifier.
 */

const START_SOON_WINDOW_MS = 60 * 60 * 1000; // 1h avant le départ
// À la fin d'une arène, on ne notifie que si elle s'est terminée récemment :
// évite d'arroser tous les participants d'arènes finies avant le déploiement
// de cette fonctionnalité.
const ENDED_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// On n'annonce une « nouvelle arène » que si elle a été créée récemment :
// évite d'envoyer un email de lancement pour des arènes déjà anciennes au
// moment du déploiement de cette fonctionnalité.
const NEW_ARENA_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PODIUM_COOLDOWN_MS = 30 * 60 * 1000; // 1 email max / 30 min / joueur / arène
const PODIUM_SIZE = 3;
// Resend limite à ~2 req/s : on espace les envois en rafale.
const SEND_SPACING_MS = 600;

// URL publique du site, avec repli sur le domaine de prod pour que les emails
// contiennent TOUJOURS un lien cliquable (même si APP_PUBLIC_URL n'est pas
// défini côté serveur, ce qui était le cas sur Railway).
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'https://btfarena.com').trim().replace(/\/$/, '');

function arenaUrl(competitionId: string): string | undefined {
  if (!APP_PUBLIC_URL) return undefined;
  return `${APP_PUBLIC_URL}/compete/leaderboard/${competitionId}`;
}

function formatPnl(pnlUsd: number, pnlPercent: number): string {
  const sign = pnlUsd >= 0 ? '+' : '';
  const pctSign = pnlPercent >= 0 ? '+' : '';
  return `${sign}${Math.round(pnlUsd).toLocaleString('fr-FR')} $ (${pctSign}${pnlPercent.toFixed(2)}%)`;
}

function formatArenaDateTime(ts: number): string {
  return new Date(ts).toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

function formatArenaDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} h`);
  if (days === 0 && hours === 0 && minutes > 0) parts.push(`${minutes} min`);
  return parts.join(' ') || '—';
}

function formatPrizeAmount(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString('fr-FR')} ${currency}`;
}

function rankShortLabel(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`;
}

function prizeHeadline(prize: CashPrize | null): string | undefined {
  if (!prize) return undefined;
  if (prize.label && prize.label.trim()) return prize.label.trim();
  if (prize.total > 0) return formatPrizeAmount(prize.total, prize.currency);
  return undefined;
}

function formatStartDelay(deltaMs: number): string {
  const minutes = Math.max(1, Math.round(deltaMs / 60_000));
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return hours <= 1 ? 'dans environ 1 heure' : `dans environ ${hours} heures`;
  }
  return `dans ${minutes} minute${minutes > 1 ? 's' : ''}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PodiumState {
  /** userIds présents dans le top 3 au tick précédent. */
  topUserIds: Set<string>;
  /** Dernier email « podium perdu » par userId (cooldown). */
  lastNotifiedAt: Map<string, number>;
}

type SendFn = typeof sendNotificationEmail;
type SendArenaFn = typeof sendNewArenaEmail;
type SendPrizeFn = typeof sendPrizeWinnerEmail;

/**
 * Construit les lots gagnés par rang à partir de la dotation : breakdown cash
 * (rang → montant) + items (lots avec un rang). Sert à n'envoyer l'email
 * « gagnant » qu'aux participants réellement récompensés.
 */
function prizeLinesByRank(prize: CashPrize | null): Map<number, string[]> {
  const byRank = new Map<number, string[]>();
  if (!prize) return byRank;
  const push = (rank: number, line: string) => {
    if (!Number.isFinite(rank) || rank < 1 || !line) return;
    const list = byRank.get(rank) || [];
    list.push(line);
    byRank.set(rank, list);
  };
  for (const entry of prize.breakdown || []) {
    if (entry.amount > 0) push(entry.rank, formatPrizeAmount(entry.amount, prize.currency));
  }
  for (const item of prize.items || []) {
    if (item.rank) push(item.rank, item.title?.trim() || `Lot ${rankShortLabel(item.rank)}`);
  }
  return byRank;
}

export class CompetitionNotifier {
  private podiumStates = new Map<string, PodiumState>();
  private running = false;
  private readonly send: SendFn;
  private readonly sendArena: SendArenaFn;
  private readonly sendPrize: SendPrizeFn;
  private readonly mailerReady: () => boolean;

  constructor(
    private readonly competitionManager: CompetitionManager,
    // Injection pour les tests : envoi factice sans toucher Resend.
    deps: { send?: SendFn; sendArena?: SendArenaFn; sendPrize?: SendPrizeFn; mailerReady?: () => boolean } = {},
  ) {
    this.send = deps.send || sendNotificationEmail;
    this.sendArena = deps.sendArena || sendNewArenaEmail;
    this.sendPrize = deps.sendPrize || sendPrizeWinnerEmail;
    this.mailerReady = deps.mailerReady || isMailerConfigured;
  }

  /** Un passage complet. Conçu pour être appelé toutes les ~60s. */
  async tick(now = Date.now()): Promise<void> {
    if (!this.mailerReady()) return;
    if (this.running) return; // un tick lent ne doit pas se chevaucher
    this.running = true;
    try {
      const competitions = this.competitionManager.listCompetitionsForNotifier();
      const liveIds = new Set<string>();
      // L'annonce « nouvelle arène » est pilotée depuis le panneau admin Emails
      // (type new_arena). Mode `off` (défaut) → aucune annonce automatique.
      let newArenaAuto = false;
      try {
        newArenaAuto = (await getEmailSettings()).kinds.new_arena?.mode !== 'off';
      } catch {
        newArenaAuto = false;
      }

      for (const competition of competitions) {
        if (competition.status === 'live') liveIds.add(competition.id);

        // Annonce « nouvelle arène disponible » : arène publique, pas encore
        // terminée, jamais annoncée et créée récemment. Placé AVANT le filtre
        // sur les arènes vides car une nouvelle arène n'a généralement aucun
        // inscrit.
        if (
          newArenaAuto &&
          competition.isPublic &&
          competition.status !== 'ended' &&
          !competition.notifiedNewArenaAt
        ) {
          if (now - competition.createdAt <= NEW_ARENA_MAX_AGE_MS) {
            await this.sendNewArena(competition.id, competition.title);
          } else {
            this.competitionManager.markCompetitionNotified(competition.id, 'newArena');
          }
        }

        if (competition.entriesCount === 0) continue;

        if ((competition.status === 'registration' || competition.status === 'starting_soon') && !competition.notifiedStartSoonAt) {
          const delta = competition.startAt - now;
          if (delta > 0 && delta <= START_SOON_WINDOW_MS) {
            await this.sendStartSoon(competition.id, competition.title, delta);
          }
        } else if (competition.status === 'live' && !competition.notifiedStartSoonAt) {
          // Fenêtre manquée (serveur down au départ) : on marque sans envoyer
          // pour ne pas annoncer un départ déjà passé.
          this.competitionManager.markCompetitionNotified(competition.id, 'startSoon');
        }

        if (competition.status === 'live') {
          await this.checkPodium(competition.id, competition.title, now);
        }

        if (competition.status === 'ended' && !competition.notifiedEndedAt) {
          if (now - competition.endAt <= ENDED_MAX_AGE_MS) {
            await this.sendEndedResults(competition.id, competition.title);
          } else {
            // Arène finie depuis longtemps (avant le déploiement de cette
            // fonctionnalité) : on marque sans envoyer.
            this.competitionManager.markCompetitionNotified(competition.id, 'ended');
          }
        }
      }

      // Libère le suivi podium des arènes qui ne sont plus live.
      for (const id of this.podiumStates.keys()) {
        if (!liveIds.has(id)) this.podiumStates.delete(id);
      }
    } catch (error) {
      console.error('[notifier] tick failed:', (error as Error)?.message);
    } finally {
      this.running = false;
    }
  }

  private async sendStartSoon(competitionId: string, title: string, deltaMs: number): Promise<void> {
    // Marqué AVANT l'envoi : si l'envoi en masse échoue à mi-chemin, on
    // préfère quelques emails manqués à un double envoi général.
    this.competitionManager.markCompetitionNotified(competitionId, 'startSoon');

    const entries = this.competitionManager.getRankedEntriesForNotifier(competitionId);
    const when = formatStartDelay(deltaMs);
    let sent = 0;
    for (const entry of entries) {
      if (!entry.email) continue;
      await this.send(entry.email, `${title} démarre bientôt !`, {
        eyebrow: title,
        heading: `L'arène démarre ${when}`,
        bodyLines: [
          `Salut ${entry.name},`,
          `L'arène « ${title} » à laquelle tu es inscrit démarre ${when}. Connecte-toi pour être prêt dès l'ouverture.`,
        ],
        ctaLabel: "Rejoindre l'arène",
        ctaUrl: arenaUrl(competitionId),
      }, 'arena_start_soon');
      sent += 1;
      await sleep(SEND_SPACING_MS);
    }
    console.log(`[notifier] start-soon "${title}" → ${sent} emails`);
  }

  private async sendNewArena(competitionId: string, title: string): Promise<number> {
    // Marqué AVANT l'envoi (anti double-blast si l'envoi en masse échoue à
    // mi-chemin : mieux vaut quelques manqués qu'un renvoi général).
    this.competitionManager.markCompetitionNotified(competitionId, 'newArena');

    const payload = this.competitionManager.getNewArenaPayload(competitionId);
    if (!payload) return 0;

    const prize = payload.cashPrize;
    const startLabel = formatArenaDateTime(payload.startAt);
    const endLabel = formatArenaDateTime(payload.endAt);
    const durationLabel = formatArenaDuration(payload.endAt - payload.startAt);
    const prizeHead = prizeHeadline(prize);
    const prizeBreakdown = prize?.breakdown && prize.breakdown.length
      ? prize.breakdown
          .slice(0, 6)
          .map((entry) => `${rankShortLabel(entry.rank)} · ${formatPrizeAmount(entry.amount, prize.currency)}`)
      : undefined;
    const prizeItems = prize?.items && prize.items.length
      ? prize.items
          .slice(0, 6)
          .map((item) => item.title?.trim() || (item.rank ? `Lot ${rankShortLabel(item.rank)}` : ''))
          .filter(Boolean)
      : undefined;
    const ctaUrl = arenaUrl(competitionId);

    let sent = 0;
    for (const recipient of payload.recipients) {
      if (!recipient.email) continue;
      await this.sendArena(recipient.email, {
        recipientName: recipient.name,
        title,
        sponsor: payload.sponsor,
        startLabel: `${startLabel} (heure de Paris)`,
        endLabel,
        durationLabel,
        prizeHeadline: prizeHead,
        prizeBreakdown,
        prizeItems,
        prizeDescription: prize?.description?.trim() || undefined,
        ctaUrl,
      });
      sent += 1;
      await sleep(SEND_SPACING_MS);
    }
    console.log(`[notifier] new-arena "${title}" → ${sent} emails`);
    return sent;
  }

  /**
   * Envoi MANUEL de l'annonce « nouvelle arène » (déclenché depuis l'admin),
   * indépendant du minuteur et de la fenêtre de 24 h. Respecte le réglage du
   * panneau (type new_arena en mode `off` → refusé). Renvoie le nombre d'envois.
   */
  async announceNewArena(competitionId: string): Promise<{ ok: boolean; sent: number; reason?: string }> {
    if (!this.mailerReady()) return { ok: false, sent: 0, reason: 'mailer-off' };
    let mode = 'off';
    try {
      mode = (await getEmailSettings()).kinds.new_arena?.mode ?? 'off';
    } catch {
      mode = 'off';
    }
    if (mode === 'off') return { ok: false, sent: 0, reason: 'blocked' };
    const payload = this.competitionManager.getNewArenaPayload(competitionId);
    if (!payload) return { ok: false, sent: 0, reason: 'not-found' };
    const sent = await this.sendNewArena(competitionId, payload.title);
    return { ok: true, sent };
  }

  private async checkPodium(competitionId: string, title: string, now: number): Promise<void> {
    const ranked = this.competitionManager.getRankedEntriesForNotifier(competitionId);
    // Un podium n'a de sens qu'avec des traders actifs : on ignore les
    // joueurs sans trade (rank attribué mais PnL vide).
    const active = ranked.filter((entry) => entry.tradesCount > 0);
    const currentTop = new Set(active.slice(0, PODIUM_SIZE).map((entry) => entry.userId));

    let state = this.podiumStates.get(competitionId);
    if (!state) {
      // Premier tick (ou après restart) : photo de référence, pas d'email.
      this.podiumStates.set(competitionId, { topUserIds: currentTop, lastNotifiedAt: new Map() });
      return;
    }

    const dropped = Array.from(state.topUserIds).filter((userId) => !currentTop.has(userId));
    state.topUserIds = currentTop;

    for (const userId of dropped) {
      const last = state.lastNotifiedAt.get(userId) || 0;
      if (now - last < PODIUM_COOLDOWN_MS) continue;
      const entry = ranked.find((row) => row.userId === userId);
      if (!entry || !entry.email) continue;
      state.lastNotifiedAt.set(userId, now);
      await this.send(entry.email, `Tu as perdu ta place sur le podium — ${title}`, {
        eyebrow: title,
        heading: 'On t\u2019a pris ta place sur le podium !',
        bodyLines: [
          `Salut ${entry.name},`,
          `Un autre trader vient de te dépasser dans « ${title} ». Tu es maintenant classé #${entry.rank}.`,
          'Reviens dans l\u2019arène pour reprendre ta place.',
        ],
        highlight: `#${entry.rank} · ${formatPnl(entry.pnlUsd, entry.pnlPercent)}`,
        ctaLabel: 'Reprendre ma place',
        ctaUrl: arenaUrl(competitionId),
      }, 'arena_podium_lost');
      console.log(`[notifier] podium-lost "${title}" → ${entry.name} (#${entry.rank})`);
      await sleep(SEND_SPACING_MS);
    }
  }

  private async sendEndedResults(competitionId: string, title: string): Promise<void> {
    this.competitionManager.markCompetitionNotified(competitionId, 'ended');

    const ranked = this.competitionManager.getRankedEntriesForNotifier(competitionId);
    const total = ranked.length;
    // Lots par rang : sert à envoyer un email distinct (demande d'adresse
    // ERC20) aux gagnants, et l'email de résultats classique aux autres.
    const winningByRank = prizeLinesByRank(this.competitionManager.getCompetitionCashPrize(competitionId));
    let sent = 0;
    let winners = 0;
    for (const entry of ranked) {
      if (!entry.email) continue;

      const prizeLines = entry.tradesCount > 0 ? winningByRank.get(entry.rank) : undefined;
      if (prizeLines && prizeLines.length) {
        // Gagnant d'un lot → email dédié pour récupérer son adresse ERC20.
        await this.sendPrize(entry.email, {
          recipientName: entry.name,
          competitionTitle: title,
          rank: entry.rank,
          rankLabel: rankShortLabel(entry.rank),
          prizeLines,
          totalParticipants: total,
        });
        winners += 1;
        sent += 1;
        await sleep(SEND_SPACING_MS);
        continue;
      }

      const onPodium = entry.rank <= PODIUM_SIZE && entry.tradesCount > 0;
      const heading = onPodium
        ? `Félicitations, tu finis #${entry.rank} !`
        : `L'arène est terminée — tu finis #${entry.rank}`;
      await this.send(entry.email, `Résultats — ${title}`, {
        eyebrow: title,
        heading,
        bodyLines: [
          `Salut ${entry.name},`,
          `L'arène « ${title} » est terminée. Voici ton résultat final sur ${total} participant${total > 1 ? 's' : ''}.`,
          'Merci d\u2019avoir participé — le classement complet est disponible sur la plateforme.',
        ],
        highlight: `#${entry.rank} / ${total} · ${formatPnl(entry.pnlUsd, entry.pnlPercent)}`,
        ctaLabel: 'Voir le classement',
        ctaUrl: arenaUrl(competitionId),
      }, 'arena_results');
      sent += 1;
      await sleep(SEND_SPACING_MS);
    }
    console.log(`[notifier] ended "${title}" → ${sent} emails (dont ${winners} gagnant${winners > 1 ? 's' : ''})`);
  }
}
