import { PageMeta } from '@/components/page-meta';
import { Wrench, CheckCircle2, ClipboardList, Camera, Package, Award } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function RepairOperations() {
 const { t } = useLanguage();
 return (
 <>
 <PageMeta
 title={t('sol.rep.meta.title')}
 description={t('sol.rep.meta.desc')}
 path="/solutions/repair-operations"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto text-center mb-16">
 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-accent0/10 border border-border mb-6">
 <Wrench className="w-8 h-8 text-primary" />
 </div>
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('sol.rep.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
 {t('sol.rep.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent0/10 flex items-center justify-center mb-6">
 <ClipboardList className="w-6 h-6 text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.rep.f1.title')}</h3>
 <p className="text-muted-foreground">{t('sol.rep.f1.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent0/10 flex items-center justify-center mb-6">
 <Camera className="w-6 h-6 text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.rep.f2.title')}</h3>
 <p className="text-muted-foreground">{t('sol.rep.f2.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent dark:bg-accent flex items-center justify-center mb-6">
 <Package className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.rep.f3.title')}</h3>
 <p className="text-muted-foreground">{t('sol.rep.f3.desc')}</p>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="w-12 h-12 rounded-xl bg-accent dark:bg-accent flex items-center justify-center mb-6">
 <Award className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 <h3 className="text-xl font-bold text-foreground mb-3">{t('sol.rep.f4.title')}</h3>
 <p className="text-muted-foreground">{t('sol.rep.f4.desc')}</p>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}