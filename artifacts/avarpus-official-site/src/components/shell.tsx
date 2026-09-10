import { ReactNode, useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, Search } from 'lucide-react';
import { Logo } from './logo';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ThemeToggle, LanguageToggle } from './controls';
import { useLanguage } from './language-provider';

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { t } = useLanguage();
  const isHomeHero = location === '/' && !scrolled;

  const NAV_LINKS = [
    { href: '/', label: t('nav.home') },
    { href: '/features', label: t('nav.features') },
    { href: '/security', label: t('nav.security') },
    { href: '/about', label: t('nav.about') },
    { href: '/support', label: t('nav.support') },
  ];

  const SOLUTION_LINKS = [
    { href: '/solutions/communication', label: t('solution.communication') },
    { href: '/solutions/repair-operations', label: t('solution.operations') },
    { href: '/solutions/finance-khata', label: t('solution.finance') },
    { href: '/solutions/team-access', label: t('solution.team') },
    { href: '/solutions/customer-dealer-access', label: t('solution.customers') },
    { href: '/solutions/backup-data', label: t('solution.backup') },
  ];
  const headerNavClass = `whitespace-nowrap rounded-[12px] border border-transparent px-3 py-2 text-sm font-semibold transition-all duration-200 ${
    isHomeHero
      ? 'text-[#475467] hover:text-[#5B5CE2] hover:bg-[#EEEDFF] dark:text-white dark:hover:bg-white/10'
      : 'text-[#475467] hover:text-[#5B5CE2] hover:bg-[#EEEDFF] dark:text-white dark:hover:bg-white/10'
  }`;

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('main-content')?.focus();
    setMenuOpen(false);
  }, [location]);

  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden bg-background transition-colors duration-300">
      {/* Header */}
      <header className={`fixed top-0 w-full z-50 transition-all duration-200 ${
        scrolled
          ? 'bg-card/60 border-b border-border/70 py-4 shadow-sm backdrop-blur-xl backdrop-saturate-150'
          : isHomeHero
            ? 'bg-card/60 border-b border-border/70 py-5 backdrop-blur-xl backdrop-saturate-150'
            : 'bg-card/60 border-b border-border/70 py-5 backdrop-blur-xl backdrop-saturate-150'
      }`}>
        <div className="container mx-auto px-4 sm:px-6 flex items-center justify-between">
          <Link href="/" className="group flex items-center gap-2.5 sm:gap-3" aria-label="Avarpus home">
            <Logo className="h-10 w-10 sm:h-11 sm:w-11 transition-transform duration-300 group-hover:scale-[1.04]" />
            <div className="flex flex-col justify-center">
              <span className={`block font-sans text-[21px] font-extrabold leading-[0.95] tracking-[-0.04em] sm:text-[22px] ${isHomeHero ? 'text-foreground dark:text-white' : 'text-foreground'}`}>Avarpus</span>
              <span className={`mt-1.5 hidden text-[9px] font-bold uppercase leading-none tracking-[0.22em] min-[1100px]:block ${isHomeHero ? 'text-muted-foreground dark:text-slate-300' : 'text-muted-foreground'}`}>Secure · Private · Connected</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden items-center gap-0.5 min-[960px]:landscape:flex xl:gap-2 2xl:gap-5">
            <Link
              href="/"
              className={headerNavClass}
            >
              {t('nav.home') || 'Home'}
            </Link>

            <Link
              href="/features"
              className={headerNavClass}
            >
              {t('nav.features') || 'Features'}
            </Link>

            <Link
              href="/security"
              className={headerNavClass}
            >
              {t('nav.security') || 'Security'}
            </Link>

            <Link
              href="/about"
              className={headerNavClass}
            >
              {t('nav.about') || 'About'}
            </Link>

            <Link
              href="/support"
              className={headerNavClass}
            >
              {t('nav.support') || 'Support'}
            </Link>

            <div className="ml-1 flex items-center gap-2 border-l border-border/30 pl-3 2xl:ml-2 2xl:gap-4 2xl:pl-6">
              <button type="button" disabled title={t('home.hero.soon')} aria-label={t('home.hero.soon')} className="hidden cursor-not-allowed opacity-65 2xl:block">
                <Search className="h-4 w-4 text-foreground dark:text-white" />
              </button>
              <LanguageToggle />
              <ThemeToggle />
              <Button asChild className="ml-2">
                <Link href="/download">{t('nav.download') || 'Download App'}</Link>
              </Button>
            </div>
          </nav>

          {/* Mobile Nav */}
          <div className="flex items-center gap-2 min-[960px]:landscape:hidden">
            <LanguageToggle />
            <ThemeToggle />
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('app.menu.label')}
                  className="text-foreground hover:bg-accent hover:text-accent-foreground dark:text-white"
                >
                  <Menu className="h-6 w-6" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[300px] overflow-y-auto border-l-border bg-card">
                <SheetTitle className="sr-only">{t('app.menu.label')}</SheetTitle>
                <div className="flex flex-col h-full pt-8">
                  <div className="mb-10 flex items-center gap-3">
                    <Logo className="h-12 w-12" />
                    <div className="flex flex-col justify-center">
                      <span className="block text-2xl font-extrabold leading-none tracking-[-0.04em] text-foreground">Avarpus</span>
                      <span className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Secure · Private · Connected</span>
                    </div>
                  </div>
                  <nav className="flex flex-col gap-6">
                    <Link
                      href="/"
                      className="rounded-xl px-3 py-2 text-lg font-semibold text-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                    >
                      {t('nav.home') || 'Home'}
                    </Link>

                    <Link
                      href="/features"
                      className="rounded-xl px-3 py-2 text-lg font-semibold text-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                    >
                      {t('nav.features') || 'Features'}
                    </Link>
                    <Link
                      href="/security"
                      className="rounded-xl px-3 py-2 text-lg font-semibold text-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                    >
                      {t('nav.security') || 'Security'}
                    </Link>
                    <Link
                      href="/about"
                      className="rounded-xl px-3 py-2 text-lg font-semibold text-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                    >
                      {t('nav.about') || 'About'}
                    </Link>
                    <Link
                      href="/support"
                      className="rounded-xl px-3 py-2 text-lg font-semibold text-foreground transition-all duration-200 hover:bg-accent hover:text-accent-foreground"
                    >
                      {t('nav.support') || 'Support'}
                    </Link>

                    <div className="h-px bg-border my-2" />
                    <Button asChild className="mt-4 w-full">
                      <Link href="/download">{t('nav.download') || 'Download App'}</Link>
                    </Button>
                  </nav>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col outline-none">
        {children}
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border/70 bg-card/60 backdrop-blur-xl backdrop-saturate-150 transition-colors duration-200">
        <div className="container mx-auto px-4 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-12 mb-12">
            <div className="lg:col-span-2">
              <Link href="/" className="flex items-center gap-3 mb-6 group">
                <Logo className="h-8 w-8 transition-transform duration-200 group-hover:scale-105" />
                <span className="text-xl font-bold text-foreground">Avarpus</span>
              </Link>
              <p className="mb-6 max-w-sm text-sm font-medium leading-relaxed text-muted-foreground">
                {t('footer.tagline')}
              </p>

            </div>

            <div>
              <h3 className="mb-6 text-xs font-bold uppercase tracking-wide text-foreground">{t('footer.product')}</h3>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li><Link href="/" className="hover:text-primary transition-colors">{t('nav.home')}</Link></li>
                <li><Link href="/features" className="hover:text-primary transition-colors">{t('nav.features')}</Link></li>
                <li><Link href="/security" className="hover:text-primary transition-colors">{t('nav.security')}</Link></li>
                <li><Link href="/about" className="hover:text-primary transition-colors">{t('nav.about')}</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="mb-6 text-xs font-bold uppercase tracking-wide text-foreground">{t('footer.legal')}</h3>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li><Link href="/privacy" className="hover:text-primary transition-colors">{t('footer.privacy')}</Link></li>
                <li><Link href="/terms" className="hover:text-primary transition-colors">{t('footer.terms')}</Link></li>
                <li><Link href="/community-guidelines" className="hover:text-primary transition-colors">{t('footer.guidelines')}</Link></li>
                <li><Link href="/delete-account" className="hover:text-primary transition-colors">{t('footer.delete')}</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="mb-6 text-xs font-bold uppercase tracking-wide text-foreground">{t('nav.support')}</h3>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li><Link href="/support" className="hover:text-primary transition-colors">{t('footer.contact')}</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="mb-6 text-xs font-bold uppercase tracking-wide text-foreground">{t('nav.download')}</h3>
              <ul className="space-y-3 text-sm font-medium text-muted-foreground">
                <li><Link href="/download" className="hover:text-primary transition-colors">{t('home.hero.btn.pending')}</Link></li>
              </ul>
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
            <p className="text-xs text-muted-foreground font-medium">
              {t('footer.info')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
