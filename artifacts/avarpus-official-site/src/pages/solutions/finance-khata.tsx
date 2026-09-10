import { PageMeta } from '@/components/page-meta';
import { Wallet, CheckCircle2, TrendingUp, RefreshCcw, Lock } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function FinanceKhata() {
 const { t } = useLanguage();
 return (
 <>
 <PageMeta
 title={t('sol.fin.meta.title')}
 description={t('sol.fin.meta.desc')}
 path="/solutions/finance-khata"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto text-center mb-16">
 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-accent dark:bg-accent border border-border dark:border-border mb-6">
 <Wallet className="w-8 h-8 text-primary dark:text-primary" />
 </div>
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('sol.fin.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
 {t('sol.fin.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent dark:bg-accent flex items-center justify-center mb-6">
 <TrendingUp className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.fin.f1.title')}</h3>
 <p className="text-muted-foreground">{t('sol.fin.f1.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent0/10 flex items-center justify-center mb-6">
 <Wallet className="w-6 h-6 text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.fin.f2.title')}</h3>
 <p className="text-muted-foreground">{t('sol.fin.f2.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent dark:bg-accent flex items-center justify-center mb-6">
 <RefreshCcw className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.fin.f3.title')}</h3>
 <p className="text-muted-foreground">{t('sol.fin.f3.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent dark:bg-accent flex items-center justify-center mb-6">
 <Lock className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.fin.f4.title')}</h3>
 <p className="text-muted-foreground">{t('sol.fin.f4.desc')}</p>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}