import { PageMeta } from '@/components/page-meta';
import { Users, BookOpen, Network, History } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function CustomerDealerAccess() {
 const { t } = useLanguage();
 return (
 <>
 <PageMeta
 title={t('sol.cust.meta.title')}
 description={t('sol.cust.meta.desc')}
 path="/solutions/customer-dealer-access"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto text-center mb-16">
 <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-[16px] border border-rose-600/20 bg-[#FEF3F2] dark:border-rose-400/20 dark:bg-rose-950/30">
 <Users className="h-8 w-8 text-[#F04438] dark:text-rose-400" />
 </div>
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('sol.cust.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
 {t('sol.cust.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEF3F2] dark:bg-rose-950/30">
 <BookOpen className="h-6 w-6 text-[#F04438] dark:text-rose-400" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.cust.f1.title')}</h3>
 <p className="text-muted-foreground">{t('sol.cust.f1.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FEF3F2] dark:bg-rose-950/30">
 <Network className="h-6 w-6 text-[#F04438] dark:text-rose-400" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.cust.f2.title')}</h3>
 <p className="text-muted-foreground">{t('sol.cust.f2.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-[#FEF3F2] flex items-center justify-center mb-6">
 <History className="h-6 w-6 text-[#F04438] dark:text-rose-400" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.cust.f3.title')}</h3>
 <p className="text-muted-foreground">{t('sol.cust.f3.desc')}</p>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}