import { newsCoverSlug, newsCoverUrl, withDisplayWidth } from '../utils/imageUrl';

type OptimizedImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Largeur d'affichage CSS (px) — sert à demander une miniature API. */
  displayWidth?: number;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
};

export default function OptimizedImage({
  src,
  alt,
  className,
  displayWidth = 128,
  width,
  height,
  sizes,
  priority = false,
}: OptimizedImageProps) {
  const resolved = withDisplayWidth(src, displayWidth) || src;
  if (!resolved) return null;

  const slug = newsCoverSlug(src);
  const srcSet = slug
    ? `${newsCoverUrl(src, 'card')} 640w, ${newsCoverUrl(src, 'full')} 1600w`
    : undefined;
  const resolvedSizes = sizes || (slug
    ? (displayWidth <= 400 ? '180px' : '(max-width: 896px) 100vw, 896px')
    : undefined);

  return (
    <img
      key={resolved}
      src={resolved}
      srcSet={srcSet}
      sizes={resolvedSizes}
      alt={alt}
      width={width}
      height={height}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'low'}
      draggable={false}
    />
  );
}

export function AvatarImage({
  src,
  alt = '',
  className,
  sizePx = 64,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  sizePx?: number;
}) {
  return (
    <OptimizedImage
      src={src}
      alt={alt}
      className={className}
      displayWidth={sizePx * 2}
    />
  );
}
