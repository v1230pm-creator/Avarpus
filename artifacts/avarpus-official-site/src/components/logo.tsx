import logoTile from '../../../mobile/assets/images/avarpus-logo-circle.png';

/**
 * Single source of truth for the Avarpus mark on the site. This is the same
 * artwork the app icon uses (white mark on the one flat brand blue), so the
 * logo never picks up a second shade or a gradient ring on any surface.
 */
export function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <img
      alt="Avarpus"
      className={`${className} inline-block shrink-0 object-contain`}
      src={logoTile}
    />
  );
}
