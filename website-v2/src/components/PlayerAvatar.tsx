import { withDisplayWidth } from '../utils/imageUrl';

interface PlayerAvatarProps {
  name: string;
  color: string;
  avatar: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  glow?: boolean;
  dimmed?: boolean;
}

const sizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-lg',
  lg: 'w-14 h-14 text-xl',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-28 h-28 text-4xl',
};

const sizePxMap = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 80,
  '2xl': 112,
};

export default function PlayerAvatar({
  name,
  color,
  avatar,
  size = 'md',
  glow = false,
  dimmed = false,
}: PlayerAvatarProps) {
  const sizeClass = sizes[size];
  const glowStyle = glow ? { boxShadow: `0 0 20px ${color}50` } : {};
  const dimClass = dimmed ? 'opacity-60' : '';
  const avatarSrc = withDisplayWidth(avatar, sizePxMap[size] * 2);

  if (avatarSrc) {
    return (
      <div
        className={`${sizeClass} ${dimClass} rounded-full overflow-hidden border-2 shrink-0`}
        style={{ borderColor: color, ...glowStyle }}
      >
        <img
          src={avatarSrc}
          alt={name}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          fetchPriority="low"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} ${dimClass} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ backgroundColor: color, ...glowStyle }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
