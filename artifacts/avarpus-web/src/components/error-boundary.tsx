// ErrorBoundary implementation placeholder - minimal since it already exists
import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  resetKey?: any;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
          <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
          <pre className="text-sm bg-muted p-4 rounded text-left max-w-lg overflow-auto">
            {this.state.error?.message}
          </pre>
          <button 
            className="mt-6 px-4 py-2 bg-primary text-primary-foreground rounded-md"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
