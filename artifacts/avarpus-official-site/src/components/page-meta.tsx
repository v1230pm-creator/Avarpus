import { useEffect } from 'react';

interface PageMetaProps {
  title: string;
  description: string;
  path?: string;
}

export function PageMeta({ title, description, path = '' }: PageMetaProps) {
  useEffect(() => {
    // Standard meta
    document.title = `${title} | Avarpus`;

    const updateTag = (selector: string, attr: string, value: string) => {
      let el = document.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        if (selector.includes('name=')) {
          const name = selector.match(/name="([^"]+)"/)?.[1];
          if (name) el.setAttribute('name', name);
        } else if (selector.includes('property=')) {
          const prop = selector.match(/property="([^"]+)"/)?.[1];
          if (prop) el.setAttribute('property', prop);
        }
        document.head.appendChild(el);
      }
      el.setAttribute(attr, value);
    };

    updateTag('meta[name="description"]', 'content', description);

    // Open Graph
    updateTag('meta[property="og:title"]', 'content', title);
    updateTag('meta[property="og:description"]', 'content', description);
    const fullUrl = `https://avarpass.com${path}`;
    updateTag('meta[property="og:url"]', 'content', fullUrl);
    updateTag('meta[property="og:image"]', 'content', 'https://avarpass.com/og-image.png');

    // Twitter
    updateTag('meta[name="twitter:title"]', 'content', title);
    updateTag('meta[name="twitter:description"]', 'content', description);
    updateTag('meta[name="twitter:image"]', 'content', 'https://avarpass.com/og-image.png');

    // Canonical
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', fullUrl);

  }, [title, description, path]);

  return null;
}
