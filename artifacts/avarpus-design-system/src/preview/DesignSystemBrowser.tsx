import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '../components/ui/input';
import { Spinner } from '../components/ui/spinner';
import { Button } from '../components/ui/button';
const logoUrl = `${import.meta.env.BASE_URL}avarpus-logo.png`;
import { ALL_ENTRIES, DESIGN_SYSTEM, NAV_GROUPS, OVERVIEW_ENTRY, type NavGroup } from './registry';

// The hash carries two independent params: #page=<entry>&theme=<light|dark>.
// Updating one must preserve the other so deep links stay shareable.
function readHashParams(): URLSearchParams {
  return new URLSearchParams(window.location.hash.slice(1));
}

function writeHashParam(key: string, value: string) {
  const params = readHashParams();
  params.set(key, value);
  window.location.hash = params.toString();
}

function readHashId(): string | null {
  const id = readHashParams().get('page');
  if (!id) {
    // No page param (e.g. a demo's decorative "#customers" anchor): leave the
    // current page alone rather than bouncing to the Overview.
    return null;
  }
  return ALL_ENTRIES.some((entry) => entry.id === id) ? id : OVERVIEW_ENTRY.id;
}

function useSelectedId(): [string, (id: string) => void] {
  const [selected, setSelected] = useState(() => readHashId() ?? OVERVIEW_ENTRY.id);

  useEffect(() => {
    const onHashChange = () => {
      const next = readHashId();
      if (next) setSelected(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const select = (id: string) => {
    setSelected(id);
    writeHashParam('page', id);
  };

  return [selected, select];
}

function NavigationItems({
  showOverview,
  groups,
  activeId,
  query,
  select,
}: {
  showOverview: boolean;
  groups: NavGroup[];
  activeId: string;
  query: string;
  select: (id: string) => void;
}) {
  return (
    <nav aria-label="Design system navigation" className="space-y-5 py-2">
      {showOverview ? (
        <button
          type="button"
          onClick={() => select(OVERVIEW_ENTRY.id)}
          aria-current={OVERVIEW_ENTRY.id === activeId}
          className="block w-full rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-muted aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
        >
          {OVERVIEW_ENTRY.name}
        </button>
      ) : null}

      {groups.map((group) => (
        <div key={group.name}>
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {group.name}
          </p>
          <div className="mt-2 space-y-1 border-l pl-2">
            {group.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => select(entry.id)}
                aria-current={entry.id === activeId}
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground"
              >
                {entry.name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {!showOverview && groups.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">No sections match “{query}”.</p>
      ) : null}
    </nav>
  );
}

const THEME_KEY = 'avarpus-ds-theme';

function readInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  // Deep links may pin a theme (#page=table&theme=dark) for reviews and screenshots.
  const linked = readHashParams().get('theme');
  if (linked === 'light' || linked === 'dark') return linked;
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(readInitialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        setTheme(next);
        writeHashParam('theme', next);
      }}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </Button>
  );
}

export function DesignSystemBrowser() {
  const [selectedId, select] = useSelectedId();
  const [query, setQuery] = useState('');
  const mobileNav = useRef<HTMLDetailsElement>(null);
  const mobileNavSummary = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        entries: group.name.toLowerCase().includes(normalizedQuery)
          ? group.entries
          : group.entries.filter((entry) =>
              `${entry.name} ${entry.description}`.toLowerCase().includes(normalizedQuery),
            ),
      })).filter((group) => group.entries.length > 0),
    [normalizedQuery],
  );

  const active = ALL_ENTRIES.find((entry) => entry.id === selectedId) ?? OVERVIEW_ENTRY;
  const activeGroup = NAV_GROUPS.find((group) =>
    group.entries.some((entry) => entry.id === active.id),
  );
  const ActivePage = active.Page;

  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(active.id);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // Move focus to the new page so keyboard and screen-reader users land on
    // its heading instead of staying inside the 50+ item navigation.
    if (previousPage.current !== active.id) {
      previousPage.current = active.id;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [active.id]);

  const showOverview = `${OVERVIEW_ENTRY.name} ${OVERVIEW_ENTRY.description}`
    .toLowerCase()
    .includes(normalizedQuery);
  const selectPage = (id: string) => {
    select(id);
    if (mobileNav.current?.open) {
      mobileNav.current.removeAttribute('open');
      mobileNavSummary.current?.focus();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[260px_minmax(0,1fr)]">
      <a
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside className="border-b bg-muted/20 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <img
            src={logoUrl}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight">{DESIGN_SYSTEM.title}</p>
          </div>
          <ThemeToggle />
        </div>
        <div className="p-4 pb-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search design system"
            placeholder="Search design system…"
          />
        </div>
        <div className="hidden min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:block">
          <NavigationItems
            showOverview={showOverview}
            groups={filteredGroups}
            activeId={active.id}
            query={query}
            select={selectPage}
          />
        </div>
        <details ref={mobileNav} className="border-t px-4 py-3 md:hidden">
          <summary ref={mobileNavSummary} className="cursor-pointer text-sm font-medium">
            Browse sections: <span className="text-muted-foreground">{active.name}</span>
          </summary>
          <div className="mt-3 h-64 overflow-y-auto pb-2">
            <NavigationItems
              showOverview={showOverview}
              groups={filteredGroups}
              activeId={active.id}
              query={query}
              select={selectPage}
            />
          </div>
        </details>
      </aside>

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className="min-w-0 px-6 py-10 outline-none sm:px-10 lg:px-14"
      >
        <div className="mx-auto max-w-5xl">
          <header className="border-b pb-8">
            {active.id === OVERVIEW_ENTRY.id ? (
              <>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {DESIGN_SYSTEM.title}
                </h1>
                <p className="mt-3 max-w-2xl text-muted-foreground">{DESIGN_SYSTEM.description}</p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {activeGroup?.name}
                </p>
                <h1 className="mt-2 text-2xl font-semibold">{active.name}</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{active.description}</p>
              </>
            )}
          </header>

          <div className="pt-8">
            <Suspense
              fallback={
                <div className="flex items-center gap-3 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                  <Spinner size={20} label={null} />
                  Loading preview…
                </div>
              }
            >
              <ActivePage />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
