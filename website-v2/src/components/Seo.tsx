import { Helmet } from 'react-helmet-async';
import { useTranslation } from 'react-i18next';

export const SITE_URL = 'https://btfarena.com';
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png?v=2`;

type SeoProps = {
  /** Page title (without the brand suffix, which is appended automatically). */
  title: string;
  description: string;
  /** Absolute path on the site, e.g. "/compete". Used for canonical + og:url. */
  path: string;
  image?: string;
  /** Set true on pages that should not be indexed (e.g. private dashboards). */
  noindex?: boolean;
  /** Override the og:type (default "website"). */
  type?: string;
  keywords?: string;
  /** Optional schema.org JSON-LD (single object or array) injected as <script>. */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const BRAND = 'BTF Arena';

export default function Seo({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  noindex = false,
  type = 'website',
  keywords,
  jsonLd,
}: SeoProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';
  const ogLocale = lang === 'fr' ? 'fr_FR' : 'en_US';
  const altLocale = lang === 'fr' ? 'en_US' : 'fr_FR';

  const fullTitle = title.includes(BRAND) ? title : `${title} — ${BRAND}`;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${SITE_URL}${cleanPath === '/' ? '' : cleanPath}`;

  return (
    <Helmet>
      <html lang={lang} />
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords ? <meta name="keywords" content={keywords} /> : null}
      <link rel="canonical" href={url} />
      {noindex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta name="robots" content="index, follow, max-image-preview:large" />
      )}

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={BRAND} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={image} />
      <meta property="og:locale" content={ogLocale} />
      <meta property="og:locale:alternate" content={altLocale} />

      {/* Twitter / X */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />

      {/* Structured data (schema.org JSON-LD) */}
      {jsonLd ? (
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      ) : null}
    </Helmet>
  );
}
