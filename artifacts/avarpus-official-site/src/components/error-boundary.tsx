import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useLanguage } from '@/components/language-provider';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  const { t } = useLanguage();
  const fallback = {
    en: {
      title: 'Something went wrong',
      desc: 'We encountered an unexpected error. Please refresh the page.',
      refresh: 'Refresh page',
    },
    hi: {
      title: 'कुछ गलत हो गया',
      desc: 'एक अप्रत्याशित त्रुटि हुई। कृपया पृष्ठ को रीफ़्रेश करें।',
      refresh: 'पृष्ठ रीफ़्रेश करें',
    },
  } as const;
  const fallbackLanguage =
    typeof document !== 'undefined' && document.documentElement.lang === 'hi'
      ? 'hi'
      : 'en';
  const translate = (
    key: string,
    fallbackKey: keyof (typeof fallback)['en'],
  ) => {
    const value = t(key);
    return value === key ? fallback[fallbackLanguage][fallbackKey] : value;
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6 transition-colors duration-300">
      <div className="max-w-lg w-full text-center">
        <h1 className="text-xl font-semibold text-foreground">
          {translate('error.boundary.title', 'title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translate('error.boundary.desc', 'desc')}
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded bg-muted p-3 text-left text-xs text-foreground">
            {error.message || String(error)}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={resetError}
          className="mt-4 rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          {translate('error.boundary.refresh', 'refresh')}
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
