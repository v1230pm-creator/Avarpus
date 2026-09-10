import { cn } from '@/lib/utils';
import logo from '@mobile-brand/avarpus-primary-logo.png';

interface AvarpusLogoProps {
  className?: string;
  alt?: string;
}

export function AvarpusLogo({ className, alt = 'Avarpus' }: AvarpusLogoProps) {
  return (
    <img
      className={cn('shrink-0 object-contain', className)}
      src={logo}
      alt={alt}
    />
  );
}