import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme } = useTheme();
  const { t } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-[#667085] hover:bg-[#EEEDFF] hover:text-[#5B5CE2] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t('app.theme.toggle.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border">
        <DropdownMenuItem onClick={() => setTheme('light')} className="cursor-pointer text-primary hover:text-primary/80">
          <Sun className="mr-2 h-4 w-4" />
          <span>{t('theme.light')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')} className="cursor-pointer text-primary hover:text-primary/80">
          <Moon className="mr-2 h-4 w-4" />
          <span>{t('theme.dark')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')} className="cursor-pointer text-primary hover:text-primary/80">
          <Monitor className="mr-2 h-4 w-4" />
          <span>{t('theme.system')}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('app.lang.toggle.label')}
          className="font-semibold text-[#667085] hover:bg-[#EEEDFF] hover:text-[#5B5CE2] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
        >
          {language === 'en' ? 'EN' : 'HI'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-popover border-border min-w-[120px]">
        <DropdownMenuItem onClick={() => setLanguage('en')} className="cursor-pointer font-medium text-primary hover:text-primary/80">
          {t('app.lang.en')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLanguage('hi')} className="cursor-pointer font-medium text-primary hover:text-primary/80">
          {t('app.lang.hi')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
