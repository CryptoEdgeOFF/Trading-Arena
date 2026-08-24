import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Seo from './Seo';
import CompeteHeader from './CompeteHeader';
import { analytics } from '../lib/analytics';

type PartnerCategory = 'exchange' | 'broker' | 'prop' | 'tool' | 'community';

interface Partner {
  id: string;
  name: string;
  category: PartnerCategory;
  accent: string;
  tagline: string;
  highlight: string;
  description?: string;
  perks: string[];
  promoCode?: string;
  referralUrl?: string;
  photoUrl?: string;
  featured?: boolean;
}

const CATEGORY_ORDER: PartnerCategory[] = ['exchange', 'broker', 'prop', 'tool', 'community'];

function isPartnerLive(partner: Partner): boolean {
  return Boolean(partner.referralUrl && partner.referralUrl !== '#');
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function PartnerLogo({ partner, size = 'md' }: { partner: Partner; size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-14 w-14' : 'h-11 w-11';
  if (partner.photoUrl) {
    return (
      <span className={`flex ${dim} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-transparent`}>
        <img src={partner.photoUrl} alt={partner.name} className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-xl border text-base font-bold`}
      style={{
        borderColor: `${partner.accent}55`,
        backgroundColor: `${partner.accent}1a`,
        color: partner.accent,
      }}
    >
      {getInitials(partner.name)}
    </span>
  );
}

function CopyCodeButton({ code, accent, partner }: { code: string; accent: string; partner: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      analytics.promoCodeCopy({ partner, code });
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard indispo (vieux navigateur / contexte non sécurisé) : on ignore.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="group flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-2.5 transition-colors"
      style={{ borderColor: `${accent}66`, backgroundColor: `${accent}12` }}
      title={t('bonus.copyCode')}
    >
      <span className="micro shrink-0 text-[9px] uppercase tracking-[0.18em] text-[#9a9aa6]">{t('bonus.code')}</span>
      <span className="num min-w-0 flex-1 break-all text-left text-sm font-bold tracking-[0.12em] text-white">{code}</span>
      <span className="shrink-0 text-[#a5a5b0] group-hover:text-white" style={{ color: copied ? accent : undefined }}>
        {copied ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </span>
    </button>
  );
}

function summarizeHighlightBadge(highlight: string): string | null {
  const text = highlight.trim();
  if (!text) return null;
  const percent = text.match(/-?\d+%/);
  if (percent) return percent[0];
  const dollar = text.match(/\$\d+/);
  if (dollar) return dollar[0];
  if (/^free\b/i.test(text)) return 'Free';
  return null;
}

function HighlightCornerBadge({ shortLabel, accent, featured = false }: { shortLabel: string; accent: string; featured?: boolean }) {
  return (
    <div
      className="absolute right-3 top-3 z-10 rounded-lg border px-2.5 py-1 shadow-lg sm:right-4 sm:top-4"
      style={{
        borderColor: `${accent}55`,
        backgroundColor: `${accent}18`,
        boxShadow: `0 10px 28px -12px ${accent}aa`,
      }}
    >
      <span
        className={`num block font-bold leading-none tracking-tight text-white ${
          featured ? 'text-xl sm:text-2xl' : 'text-lg sm:text-xl'
        }`}
      >
        {shortLabel}
      </span>
    </div>
  );
}

function PartnerCard({ partner, index, featured = false }: { partner: Partner; index: number; featured?: boolean }) {
  const { t } = useTranslation();
  const live = isPartnerLive(partner);
  const categoryLabel = t(`bonus.categories.${partner.category}`);
  const highlightBadge = partner.highlight ? summarizeHighlightBadge(partner.highlight) : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay: Math.min(index, 6) * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-[#1c1c24] bg-[#0b0b0f] p-5 transition-colors hover:border-[color:var(--p-accent)]/50 sm:p-6"
      style={{ '--p-accent': partner.accent } as React.CSSProperties}
    >
      {highlightBadge && (
        <HighlightCornerBadge shortLabel={highlightBadge} accent={partner.accent} featured={featured} />
      )}

      <div
        className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full opacity-60 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
        style={{ backgroundColor: `${partner.accent}1f` }}
      />

      <div className="relative flex items-start gap-3">
        <PartnerLogo partner={partner} size={featured ? 'lg' : 'md'} />
        <div className="min-w-0 flex-1 pr-14 sm:pr-16">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="display truncate text-lg font-bold text-white sm:text-xl">{partner.name}</h3>
            <span
              className="rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em]"
              style={{ borderColor: `${partner.accent}55`, color: partner.accent, backgroundColor: `${partner.accent}12` }}
            >
              {categoryLabel}
            </span>
          </div>
          {partner.tagline && <p className="mt-1 text-sm text-[#9a9aa6]">{partner.tagline}</p>}
        </div>
      </div>

      {partner.description && partner.description !== partner.tagline && (
        <p className="relative mt-3 text-sm leading-relaxed text-[#b8b8c2]">{partner.description}</p>
      )}

      {partner.perks.length > 0 && (
        <ul className="relative mt-4 space-y-2">
          {partner.perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2 text-sm text-[#b8b8c2]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={partner.accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Footer collé en bas pour aligner les cartes de hauteurs différentes. */}
      <div className="relative mt-auto pt-5">
        {partner.highlight && (
          <div
            className="mb-3 flex items-center gap-2 rounded-xl border px-3 py-2.5"
            style={{ borderColor: `${partner.accent}33`, backgroundColor: `${partner.accent}0d` }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={partner.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <path d="M20 12v8H4v-8M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 2.1-3.85M12 7h4.5a2.5 2.5 0 1 0-2.1-3.85" />
            </svg>
            <span className="text-sm font-semibold leading-snug text-white">{partner.highlight}</span>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {partner.promoCode && <CopyCodeButton code={partner.promoCode} accent={partner.accent} partner={partner.name} />}
          {live ? (
            <a
              href={partner.referralUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              onClick={() => analytics.promoClick({ partner: partner.name, category: partner.category, url: partner.referralUrl })}
              className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-[0.12em] text-black transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: partner.accent, boxShadow: `0 16px 40px -18px ${partner.accent}` }}
            >
              {t('bonus.claim')}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7 17 17 7M7 7h10v10" />
              </svg>
            </a>
          ) : (
            <span className="w-full rounded-xl border border-[#232329] bg-[#0c0c10] px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-[0.12em] text-[#71717a]">
              {t('bonus.soon')}
            </span>
          )}
        </div>
      </div>
    </motion.article>
  );
}

export default function TradeLiveBonus() {
  const { t, i18n } = useTranslation();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/promotions?lang=${lang}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPartners((data.promotions as Partner[]) || []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const featured = useMemo(() => partners.filter((p) => p.featured), [partners]);
  const byCategory = useMemo(() => {
    const groups = new Map<PartnerCategory, Partner[]>();
    for (const partner of partners) {
      if (partner.featured) continue;
      const list = groups.get(partner.category) ?? [];
      list.push(partner);
      groups.set(partner.category, list);
    }
    return groups;
  }, [partners]);

  let cardIndex = 0;

  return (
    <div className="compete min-h-dvh-safe bg-[#050507]">
      <Seo
        title={t('seo.bonusTitle')}
        description={t('seo.bonusDesc')}
        path="/compete/bonus"
      />
      <div className="compete-bg min-h-dvh-safe">
        <CompeteHeader />

        <main className="mx-auto max-w-6xl px-5 py-10 md:px-8">
          {/* HERO */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-3xl border border-[#dc2626]/25 bg-gradient-to-br from-[#1a0709] via-[#0c0508] to-[#0a0a0d] p-6 md:p-9"
          >
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#dc2626]/20 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <span className="h-px w-6 bg-[#dc2626]" />
                <span className="micro text-[10px] text-[#dc2626]">{t('bonus.eyebrow')}</span>
              </div>
              <h1 className="display mt-3 text-3xl font-bold leading-[1.05] text-white md:text-5xl">{t('bonus.title')}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#b8b8c2] md:text-base">{t('bonus.subtitle')}</p>
              <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-[11px] font-medium text-amber-200">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                {t('bonus.disclaimer')}
              </p>
            </div>
          </motion.div>

          {loading ? (
            <div className="mt-10 text-center text-sm text-[#71717a]">{t('common.loading')}</div>
          ) : partners.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-[#232329] bg-[#0a0a0d] px-6 py-12 text-center text-sm text-[#71717a]">
              {t('bonus.empty')}
            </div>
          ) : (
            <>
              {featured.length > 0 && (
                <section className="mt-10">
                  <div className="flex items-center gap-2">
                    <span className="micro text-[10px] text-[#dc2626]">{t('bonus.featuredEyebrow')}</span>
                  </div>
                  <div className="mt-4 grid gap-5 md:grid-cols-2">
                    {featured.map((partner) => (
                      <PartnerCard key={partner.id} partner={partner} index={cardIndex++} featured />
                    ))}
                  </div>
                </section>
              )}

              {CATEGORY_ORDER.map((category) => {
                const list = byCategory.get(category);
                if (!list || list.length === 0) return null;
                return (
                  <section key={category} className="mt-12">
                    <div className="border-b border-[#1a1a20] pb-4">
                      <div className="flex items-center gap-2">
                        <span className="h-px w-6 bg-[#dc2626]" />
                        <span className="micro text-[10px] text-[#dc2626]">{t(`bonus.categories.${category}`)}</span>
                      </div>
                      <h2 className="display mt-2 text-2xl font-bold text-white md:text-3xl">{t(`bonus.sectionTitles.${category}`)}</h2>
                    </div>
                    <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                      {list.map((partner) => (
                        <PartnerCard key={partner.id} partner={partner} index={cardIndex++} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
