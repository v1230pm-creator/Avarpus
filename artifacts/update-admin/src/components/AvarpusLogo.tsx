import { cn } from '@/lib/utils';
import logoDark from '@mobile-brand/avarpus-logo-dark.png';
import logoLight from '@mobile-brand/avarpus-logo-light.png';

interface AvarpusLogoProps {
  className?: string;
  alt?: string;
}

export function AvarpusLogo({ className, alt = 'Avarpus' }: AvarpusLogoProps) {
  return (
    <picture className="shrink-0">
      <source media="(prefers-color-scheme: dark)" srcSet={logoDark} />
      <img className={cn('object-contain', className)} src={logoLight} alt={alt} />
    </picture>
  );
}