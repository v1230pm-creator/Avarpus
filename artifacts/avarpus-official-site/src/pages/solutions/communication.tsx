import { PageMeta } from '@/components/page-meta';
import { MessageSquare, Server, EyeOff, ShieldCheck, Activity, Users } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function Communication() {
 const { t } = useLanguage();
 return (
 <>
 <PageMeta
 title={t('sol.comm.meta.title')}
 description={t('sol.comm.meta.desc')}
 path="/solutions/communication"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto text-center mb-16">
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('sol.comm.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
 {t('sol.comm.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
 <div className="bg-card card-shadow border border-border rounded-[16px] p-8 md:p-10">
 <Server className="w-10 h-10 text-primary dark:text-primary mb-6" />
 <h3 className="text-2xl font-bold text-foreground mb-4">{t('sol.comm.card1.title')}</h3>
 <p className="text-muted-foreground leading-relaxed mb-6">
 {t('sol.comm.card1.desc')}
 </p>
 <ul className="space-y-3">
 <li className="flex items-start gap-2 text-sm text-foreground">
 <ShieldCheck className="w-5 h-5 text-primary dark:text-primary shrink-0" />
 <span>{t('sol.comm.card1.l1')}</span>
 </li>
 <li className="flex items-start gap-2 text-sm text-foreground">
 <ShieldCheck className="w-5 h-5 text-primary dark:text-primary shrink-0" />
 <span>{t('sol.comm.card1.l2')}</span>
 </li>
 </ul>
 </div>

 <div className="bg-card card-shadow border border-border rounded-[16px] p-8 md:p-10">
 <EyeOff className="w-10 h-10 text-primary dark:text-primary mb-6" />
 <h3 className="text-2xl font-bold text-foreground mb-4">{t('sol.comm.card2.title')}</h3>
 <p className="text-muted-foreground leading-relaxed mb-6">
 {t('sol.comm.card2.desc')}
 </p>
 <ul className="space-y-3">
 <li className="flex items-start gap-2 text-sm text-foreground">
 <Users className="w-5 h-5 text-primary dark:text-primary shrink-0" />
 <span>{t('sol.comm.card2.l1')}</span>
 </li>
 <li className="flex items-start gap-2 text-sm text-foreground">
 <Users className="w-5 h-5 text-primary dark:text-primary shrink-0" />
 <span>{t('sol.comm.card2.l2')}</span>
 </li>
 </ul>
 </div>
 </div>

 <div className="bg-accent border border-border dark:border-border rounded-[16px] p-8 md:p-12 text-center max-w-4xl mx-auto">
 <Activity className="w-12 h-12 text-primary dark:text-primary mx-auto mb-6" />
 <h2 className="text-3xl font-bold text-foreground mb-4">{t('sol.comm.status.title')}</h2>
 <p className="text-muted-foreground leading-relaxed mb-8 max-w-2xl mx-auto">
 {t('sol.comm.status.desc')}
 </p>
 <Button asChild size="lg" className="rounded-[12px] bg-primary px-8 font-bold text-primary-foreground transition-colors duration-200 ">
 <Link href="/download">
 {t('sol.comm.btn')}
 </Link>
 </Button>
 </div>
 </div>
 </div>
 </>
 );
}