import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type LegalPageType = 'cgu' | 'confidentialite' | 'mentions' | 'risques' | 'reglement';

interface LegalSection {
  title: string;
  body: string;
}

export function LegalPage({ type }: { type: LegalPageType }) {
  const { t } = useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const backTo = from === 'compete' ? '/compete' : '/compete';

  const title = t(`legal.${type}.title`);
  const intro = t(`legal.${type}.intro`);
  const sections = t(`legal.${type}.sections`, { returnObjects: true }) as LegalSection[];

  return (
    <main className="min-h-screen bg-[#050506] px-5 pb-24 pt-10 text-white">
      <div className="mx-auto max-w-4xl">
        <Link to={backTo} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-300 transition-colors hover:text-red-200">
          {t('legal.back')}
        </Link>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-2xl shadow-black/40 md:p-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8f96a3]">{t('legal.brand')}</p>
          <h1 className="mt-3 font-rajdhani text-4xl font-bold tracking-tight text-white md:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[#b8bdc9]">{intro}</p>

          <div className="mt-8 space-y-5">
            {sections.map((section) => (
              <article key={section.title} className="rounded-2xl border border-white/8 bg-black/25 p-5">
                <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-red-200">{section.title}</h2>
                <p className="mt-3 text-sm leading-7 text-[#d7dae3]">{section.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
