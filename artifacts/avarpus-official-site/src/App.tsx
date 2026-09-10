import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { Shell } from '@/components/shell';
import Home from '@/pages/home';
import About from '@/pages/about';
import Features from '@/pages/features';
import Security from '@/pages/security';
import Privacy from '@/pages/privacy';
import Terms from '@/pages/terms';
import CommunityGuidelines from '@/pages/community-guidelines';
import DeleteAccount from '@/pages/delete-account';
import Support from '@/pages/support';
import Download from '@/pages/download';
import NotFound from '@/pages/not-found';

import Communication from '@/pages/solutions/communication';
import RepairOperations from '@/pages/solutions/repair-operations';
import FinanceKhata from '@/pages/solutions/finance-khata';
import TeamAccess from '@/pages/solutions/team-access';
import CustomerDealerAccess from '@/pages/solutions/customer-dealer-access';
import BackupData from '@/pages/solutions/backup-data';

import { ThemeProvider } from '@/components/theme-provider';
import { LanguageProvider, registerTranslations } from '@/components/language-provider';

import { en as shellEn, hi as shellHi } from '@/locales/shell';
import { en as homeEn, hi as homeHi } from '@/locales/home';
import { en as featEn, hi as featHi } from '@/locales/features';
import { en as pagesEn, hi as pagesHi } from '@/locales/pages';
import { en as solEn, hi as solHi } from '@/locales/solutions';

registerTranslations(shellEn, shellHi);
registerTranslations(homeEn, homeHi);
registerTranslations(featEn, featHi);
registerTranslations(pagesEn, pagesHi);
registerTranslations(solEn, solHi);

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/about" component={About} />
          <Route path="/features" component={Features} />

          <Route path="/solutions/communication" component={Communication} />
          <Route path="/solutions/repair-operations" component={RepairOperations} />
          <Route path="/solutions/finance-khata" component={FinanceKhata} />
          <Route path="/solutions/team-access" component={TeamAccess} />
          <Route path="/solutions/customer-dealer-access" component={CustomerDealerAccess} />
          <Route path="/solutions/backup-data" component={BackupData} />

          <Route path="/security" component={Security} />
          <Route path="/privacy" component={Privacy} />
          <Route path="/terms" component={Terms} />
          <Route path="/community-guidelines" component={CommunityGuidelines} />
          <Route path="/delete-account" component={DeleteAccount} />
          <Route path="/support" component={Support} />
          <Route path="/download" component={Download} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <ThemeProvider defaultTheme="system">
      <LanguageProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
