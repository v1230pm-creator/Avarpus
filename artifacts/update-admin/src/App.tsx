import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Layout } from '@/components/layout';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Releases from '@/pages/releases';
import ReleaseEditor from '@/pages/releases/edit';
import { setAuthTokenGetter, setUnauthorizedHandler, useAuthMe, getAuthMeQueryKey } from '@workspace/api-client-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

setAuthTokenGetter(() => localStorage.getItem('auth_token'));

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const [location, setLocation] = useLocation();
  const { data: me, isLoading, error } = useAuthMe({
    query: {
      retry: false,
      queryKey: getAuthMeQueryKey()
    }
  });

  useEffect(() => {
    if (!isLoading && (error || !me)) {
      setLocation('/login');
    } else if (me && me.user.role !== 'super_admin') {
      // Not super admin, log them out
      localStorage.removeItem('auth_token');
      setLocation('/login');
    }
  }, [me, isLoading, error, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-pulse flex flex-col items-center gap-4"><div className="h-8 w-8 bg-primary rounded-full animate-bounce" /><div className="text-muted-foreground text-sm font-medium">Verifying session...</div></div></div>;
  }

  if (!me || me.user.role !== 'super_admin') {
    return null; // Will redirect in useEffect
  }

  return (
    <Layout>
      <Component {...rest} />
    </Layout>
  );
}

function Router() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      localStorage.removeItem('auth_token');
      setLocation('/login');
    });
  }, [setLocation]);

  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/login" component={Login} />
        
        {/* Protected Routes */}
        <Route path="/">
          {(params) => <ProtectedRoute component={Dashboard} params={params} />}
        </Route>
        <Route path="/releases">
          {(params) => <ProtectedRoute component={Releases} params={params} />}
        </Route>
        <Route path="/releases/new">
          {(params) => <ProtectedRoute component={ReleaseEditor} params={params} />}
        </Route>
        <Route path="/releases/:id">
          {(params) => <ProtectedRoute component={ReleaseEditor} params={params} />}
        </Route>
        
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => document.documentElement.classList.toggle('dark', query.matches);

    syncTheme();
    query.addEventListener('change', syncTheme);
    return () => query.removeEventListener('change', syncTheme);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;