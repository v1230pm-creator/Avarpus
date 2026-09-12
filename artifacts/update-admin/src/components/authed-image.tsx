import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ImageOff } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

interface AuthedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  objectPath: string;
  fallback?: React.ReactNode;
}

export function AuthedImage({ objectPath, className, fallback, alt, ...props }: AuthedImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    let isMounted = true;

    async function loadImage() {
      if (!objectPath) {
        setLoading(false);
        setError(true);
        return;
      }
      
      try {
        setLoading(true);
        setError(false);
        
        const token = localStorage.getItem('auth_token');
        const uuid = objectPath.split('/').pop();
        const response = await fetch(`/api/app-updates/assets/${uuid}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) throw new Error('Failed to load image');
        
        const blob = await response.blob();
        if (isMounted) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Error loading image:', err);
          setError(true);
          setLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [objectPath]);

  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        {fallback || <ImageOff className="h-6 w-6" />}
      </div>
    );
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/50", className)}>
        <Spinner size={24} className="text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <img 
      src={src!} 
      alt={alt || "Asset"} 
      className={cn("object-cover", className)} 
      {...props} 
    />
  );
}
