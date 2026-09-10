import { PageMeta } from '@/components/page-meta';
import { HardDrive, Server, ShieldCheck, DownloadCloud } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function BackupData() {
 const { t } = useLanguage();
 return (
 <>
 <PageMeta
 title={t('sol.bak.meta.title')}
 description={t('sol.bak.meta.desc')}
 path="/solutions/backup-data"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto text-center mb-16">
 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-accent dark:bg-accent border border-border dark:border-border mb-6">
 <HardDrive className="w-8 h-8 text-primary dark:text-primary" />
 </div>
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('sol.bak.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
 {t('sol.bak.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
 <div className="bg-card card-shadow border border-border rounded-[16px] p-8 md:p-10">
 <Server className="w-10 h-10 text-primary dark:text-primary mb-6" />
 <h3 className="text-2xl font-bold text-foreground mb-4">{t('sol.bak.card1.title')}</h3>
 <p className="text-muted-foreground leading-relaxed mb-6">
 {t('sol.bak.card1.desc')}
 </p>
 </div>

 <div className="bg-card card-shadow border border-border rounded-[16px] p-8 md:p-10">
 <DownloadCloud className="w-10 h-10 text-primary dark:text-primary mb-6" />
 <h3 className="text-2xl font-bold text-foreground mb-4">{t('sol.bak.card2.title')}</h3>
 <p className="text-muted-foreground leading-relaxed mb-6">
 {t('sol.bak.card2.desc')}
 </p>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}