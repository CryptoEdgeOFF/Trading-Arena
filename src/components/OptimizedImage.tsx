import { withDisplayWidth } from '../utils/imageUrl';

type OptimizedImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Largeur d'affichage CSS (px) — sert à demander une miniature API. */
  displayWidth?: number;
  priority?: boolean;
};

export default function OptimizedImage({
  src,
  alt,
  className,
  displayWidth = 128,
  priority = false,
}: OptimizedImageProps) {
  const resolved = withDisplayWidth(src, displayWidth) || src;
  if (!resolved) return null;

  return (
    <img
      src={resolved}
      alt={alt}
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
