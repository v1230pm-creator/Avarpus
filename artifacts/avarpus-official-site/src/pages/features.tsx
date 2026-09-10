import { PageMeta } from '@/components/page-meta';
import {
 MessageSquare, Phone, Activity, Users, Shield,
 Store, Wrench, Wallet, Briefcase, Database,
 UserCircle, CreditCard, ChevronRight, Lock, Bell, RefreshCw, Layers
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function Features() {
 const { t } = useLanguage();

 const FEATURE_GROUPS = [
 {
 id: "communication",
 title: t('feat.group.comm.title'),
 description: t('feat.group.comm.desc'),
 icon: MessageSquare,
 link: "/solutions/communication",
 features: [
 {
 icon: MessageSquare,
 title: t('feat.group.comm.f1.title'),
 desc: t('feat.group.comm.f1.desc')
 },
 {
 icon: Phone,
 title: t('feat.group.comm.f2.title'),
 desc: t('feat.group.comm.f2.desc')
 },
 {
 icon: Activity,
 title: t('feat.group.comm.f3.title'),
 desc: t('feat.group.comm.f3.desc')
 },
 {
 icon: Users,
 title: t('feat.group.comm.f4.title'),
 desc: t('feat.group.comm.f4.desc')
 },
 {
 icon: Layers,
 title: t('feat.group.comm.f5.title'),
 desc: t('feat.group.comm.f5.desc')
 }
 ]
 },
 {
 id: "operations",
 title: t('feat.group.ops.title'),
 description: t('feat.group.ops.desc'),
 icon: Wrench,
 link: "/solutions/repair-operations",
 features: [
 {
 icon: Wrench,
 title: t('feat.group.ops.f1.title'),
 desc: t('feat.group.ops.f1.desc')
 },
 {
 icon: Store,
 title: t('feat.group.ops.f2.title'),
 desc: t('feat.group.ops.f2.desc')
 },
 {
 icon: UserCircle,
 title: t('feat.group.ops.f3.title'),
 desc: t('feat.group.ops.f3.desc')
 }
 ]
 },
 {
 id: "finance",
 title: t('feat.group.fin.title'),
 description: t('feat.group.fin.desc'),
 icon: Wallet,
 link: "/solutions/finance-khata",
 features: [
 {
 icon: Wallet,
 title: t('feat.group.fin.f1.title'),
 desc: t('feat.group.fin.f1.desc')
 },
 {
 icon: CreditCard,
 title: t('feat.group.fin.f2.title'),
 desc: t('feat.group.fin.f2.desc')
 },
 {
 icon: Briefcase,
 title: t('feat.group.fin.f3.title'),
 desc: t('feat.group.fin.f3.desc')
 },
 {
 icon: Activity,
 title: t('feat.group.fin.f4.title'),
 desc: t('feat.group.fin.f4.desc')
 }
 ]
 },
 {
 id: "security",
 title: t('feat.group.sec.title'),
 description: t('feat.group.sec.desc'),
 icon: Shield,
 link: "/solutions/team-access",
 features: [
 {
 icon: Shield,
 title: t('feat.group.sec.f1.title'),
 desc: t('feat.group.sec.f1.desc')
 },
 {
 icon: Lock,
 title: t('feat.group.sec.f2.title'),
 desc: t('feat.group.sec.f2.desc')
 },
 {
 icon: Database,
 title: t('feat.group.sec.f3.title'),
 desc: t('feat.group.sec.f3.desc')
 },
 {
 icon: Bell,
 title: t('feat.group.sec.f4.title'),
 desc: t('feat.group.sec.f4.desc')
 },
 {
 icon: RefreshCw,
 title: t('feat.group.sec.f5.title'),
 desc: t('feat.group.sec.f5.desc')
 }
 ]
 }
 ];

 return (
 <>
 <PageMeta
 title={t('feat.meta.title')}
 description={t('feat.meta.desc')}
 path="/features"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="text-center max-w-3xl mx-auto mb-20">
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('feat.hero.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground">
 {t('feat.hero.desc')}
 </p>
 </div>

 <div className="space-y-24">
 {FEATURE_GROUPS.map((group, groupIdx) => {
 let semanticClass = "text-primary dark:text-primary";
 let semanticBgClass = "bg-accent border-border";
 let hoverBorderClass = "hover:border-border dark:border-border";
 let groupHoverBgClass = "group-hover:bg-accent dark:bg-accent group-hover:border-border dark:border-border";
 let groupHoverTextClass = "group-hover:text-primary dark:text-primary";

 if (group.id === "communication") {
 semanticClass = "text-primary dark:text-primary";
 semanticBgClass = "bg-accent border-border";
 hoverBorderClass = "hover:border-border dark:border-border";
 groupHoverBgClass = "group-hover:bg-accent dark:bg-accent group-hover:border-border dark:border-border";
 groupHoverTextClass = "group-hover:text-primary dark:text-primary";
 } else if (group.id === "operations") {
 semanticClass = "text-[#12B76A] dark:text-[#12B76A]";
 semanticBgClass = "border-border bg-[#ECFDF3] dark:border-emerald-400/20 dark:bg-emerald-950/30";
 hoverBorderClass = "hover:border-border dark:border-border";
 groupHoverBgClass = "group-hover:border-border group-hover:bg-[#ECFDF3] dark:border-emerald-400/20 dark:bg-emerald-950/30";
 groupHoverTextClass = "group-hover:text-[#12B76A] dark:text-[#12B76A]";
 } else if (group.id === "finance") {
 semanticClass = "text-primary dark:text-primary";
 semanticBgClass = "bg-accent border-border";
 hoverBorderClass = "hover:border-border dark:border-border";
 groupHoverBgClass = "group-hover:bg-accent dark:bg-accent group-hover:border-border dark:border-border";
 groupHoverTextClass = "group-hover:text-primary dark:text-primary";
 }

 return (
 <div key={group.id} className="relative">
 {groupIdx !== 0 && (
 <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-px h-12 bg-gradient-to-b from-transparent via-border to-border" />
 )}

 <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
 <div className="flex items-center gap-4">
 <div className={`w-14 h-14 rounded-[16px] border flex items-center justify-center shrink-0 ${semanticBgClass}`}>
 <group.icon className={`w-7 h-7 ${semanticClass}`} />
 </div>
 <div>
 <h2 className="text-3xl font-bold text-foreground mb-1">{group.title}</h2>
 <p className="text-muted-foreground">{group.description}</p>
 </div>
 </div>
 <Button asChild variant="outline" className="rounded-[12px] border-border text-primary hover:text-primary/80 hover:bg-muted/50 h-10 px-6 shrink-0">
 <Link href={group.link}>
 {t('feat.btn.learn')} <ChevronRight className="w-4 h-4 ml-2" />
 </Link>
 </Button>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
 {group.features.map((feat, i) => (
 <div key={i} className={`bg-card p-6 rounded-[16px] border border-border ${hoverBorderClass} hover:bg-card transition-all duration-300 group`}>
 <div className={`w-10 h-10 rounded-xl bg-accent border border-border flex items-center justify-center mb-4 ${groupHoverBgClass} transition-colors`}>
 <feat.icon className={`w-5 h-5 text-muted-foreground ${groupHoverTextClass} transition-colors`} />
 </div>
 <h3 className="text-lg font-bold mb-2 text-foreground">{feat.title}</h3>
 <p className="text-muted-foreground leading-relaxed text-sm">
 {feat.desc}
 </p>
 </div>
 ))}
 </div>
 </div>
 )})}
 </div>

 <div className="mt-24 bg-card border border-border p-12 rounded-[16px] text-center">
 <h2 className="text-3xl font-bold text-foreground mb-4">{t('feat.cta.title')}</h2>
 <p className="text-muted-foreground mb-8 max-w-2xl mx-auto">
 {t('feat.cta.desc')}
 </p>
 <Button asChild size="lg" className="download-action rounded-[12px] bg-primary px-10 text-lg font-bold text-primary-foreground transition-colors duration-200">
 <Link href="/download">
 {t('feat.cta.btn')}
 </Link>
 </Button>
 </div>
 </div>
 </div>
 </>
 );
}