import { cn } from '@/lib/utils';

interface AvarpusLogoProps {
  className?: string;
  alt?: string;
}

export function AvarpusLogo({ className, alt = 'Avarpus' }: AvarpusLogoProps) {
  const basePath = import.meta.env.BASE_URL;

  return (
    <picture className="shrink-0">
      <source media="(prefers-color-scheme: dark)" srcSet={`${basePath}brand/avarpus-logo-dark.png`} />
      <img className={cn('object-contain', className)} src={`${basePath}brand/avarpus-logo-light.png`} alt={alt} />
    </picture>
  );
}