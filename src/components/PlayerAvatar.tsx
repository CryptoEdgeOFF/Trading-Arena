interface PlayerAvatarProps {
  name: string;
  color: string;
  avatar: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  glow?: boolean;
  dimmed?: boolean;
}

const sizes = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-lg',
  lg: 'w-14 h-14 text-xl',
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

  if (avatar) {
    return (
      <div
        className={`${sizeClass} ${dimClass} rounded-full overflow-hidden border-2 shrink-0`}
        style={{ borderColor: color, ...glowStyle }}
      >
        <img
          src={avatar}
          alt={name}
          className="w-full h-full object-cover"
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
