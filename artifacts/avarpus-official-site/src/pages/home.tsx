import { Link } from 'wouter';
import { Shield, Lock, Users, Briefcase, Zap, Smartphone, ArrowRight, MessageSquare, Phone, Activity, Wrench, Store, ShieldCheck, HardDrive, PlayCircle, Settings, QrCode, BookOpenText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageMeta } from '@/components/page-meta';
import { DeviceMockup, ShopScreen } from '@/components/ui/mockup';
import { HeroShowcase } from '@/components/hero-showcase';
import { useLanguage } from '@/components/language-provider';

export default function Home() {
 const { t } = useLanguage();
 const heroBackground = `${import.meta.env.BASE_URL}avarpus-mountain-hero.jpg`;

 return (
 <>
 <PageMeta
 title={t('home.meta.title')}
 description={t('home.meta.desc')}
 />

 {/* Hero Section */}
 <section className="relative min-h-[100svh] overflow-hidden border-b border-border bg-background pt-32 pb-16 md:pt-40 md:pb-20 lg:flex lg:min-h-[850px] lg:items-center">
 <div
  className="absolute inset-0 bg-cover bg-center opacity-[0.90] dark:opacity-[0.70] lg:bg-[center_46%]"
 style={{ backgroundImage: `url(${heroBackground})` }}
 aria-hidden="true"
 />

 <div className="container mx-auto px-4 sm:px-6 relative z-10">
 <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-12 lg:gap-10">
  <div className="order-1 p-5 text-left sm:p-7 lg:col-span-6 lg:-ml-7 lg:p-7 lg:pt-7">
 <div
  className="mb-6 inline-flex items-center gap-2 text-[10px] font-bold text-sky-200 animate-fade-up tracking-[0.25em] uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.55)]"
 >
 {t('home.hero.subtitle')}
 </div>

  <h1 className="mb-2 text-5xl font-extrabold leading-[1.05] tracking-tight text-white animate-fade-up [text-shadow:0_3px_20px_rgba(0,0,0,0.58)] sm:text-6xl lg:text-7xl xl:text-[5.5rem]" style={{ animationDelay: '0.1s' }}>
 Avarpus
 </h1>
  <h2 className="mb-6 text-3xl font-bold text-white animate-fade-up [text-shadow:0_2px_16px_rgba(0,0,0,0.62)] sm:text-4xl" style={{ animationDelay: '0.15s' }}>
 {t('home.hero.title2')}
 </h2>

  <p className="mb-10 max-w-xl text-lg font-medium leading-relaxed text-white/85 animate-fade-up [text-shadow:0_2px_12px_rgba(0,0,0,0.72)]" style={{ animationDelay: '0.2s' }}>
 {t('home.hero.desc')}
 </p>

 <div className="flex flex-col items-stretch gap-4 animate-fade-up sm:flex-row sm:items-center" style={{ animationDelay: '0.3s' }}>
  <Button size="lg" className="h-auto min-h-11 whitespace-normal px-3 py-3 text-sm leading-tight sm:w-auto sm:px-5 disabled:opacity-100" disabled>
  <Smartphone className="mr-2 h-5 w-5 shrink-0" />
  <span className="min-w-0 text-center">{t('home.hero.btn.pending')}</span>
 </Button>

  <Button variant="outline" size="lg" className="h-auto min-h-11 whitespace-normal border-white/60 bg-white/82 px-3 py-3 text-sm leading-tight text-slate-900 shadow-lg sm:w-auto sm:px-5 disabled:opacity-100" disabled>
  <PlayCircle className="mr-2 h-5 w-5 shrink-0" />
 <span className="min-w-0 text-center">{t('home.hero.video')} <span className="text-[10px] ml-1 uppercase">({t('home.hero.soon')})</span></span>
 </Button>
 </div>

  <div className="mt-12 flex max-w-lg flex-wrap items-start justify-between gap-6 border-t border-white/35 pt-8 animate-fade-up sm:gap-8" style={{ animationDelay: '0.4s' }}>
 <div className="flex flex-col gap-2 text-left items-start flex-1">
  <ShieldCheck className="h-6 w-6 text-sky-200 [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.5))]" />
  <span className="whitespace-pre-line text-xs font-semibold leading-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.95)]">{t('home.hero.feature1')}</span>
 </div>
 <div className="flex flex-col gap-2 text-left items-start flex-1">
  <Zap className="h-6 w-6 text-sky-200 [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.5))]" />
  <span className="whitespace-pre-line text-xs font-semibold leading-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.95)]">{t('home.hero.feature2')}</span>
 </div>
 <div className="flex flex-col gap-2 text-left items-start flex-1">
  <Briefcase className="h-6 w-6 text-sky-200 [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.5))]" />
  <span className="whitespace-pre-line text-xs font-semibold leading-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.95)]">{t('home.hero.feature3')}</span>
 </div>
 <div className="flex flex-col gap-2 text-left items-start flex-1">
  <Users className="h-6 w-6 text-sky-200 [filter:drop-shadow(0_2px_6px_rgba(0,0,0,0.5))]" />
  <span className="whitespace-pre-line text-xs font-semibold leading-tight text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.95)]">{t('home.hero.feature4')}</span>
 </div>
 </div>
 </div>

 <div className="relative order-2 lg:col-span-6 animate-fade-in">
 <HeroShowcase />
 </div>
 </div>
 </div>
 </section>

 {/* Capability Strip */}
 <section className="py-24 bg-background relative z-20 transition-colors duration-200 border-b border-border">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="text-center mb-16">
 <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-[12px] bg-accent text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-6 border border-border">
 {t('home.cap.subtitle')}
 </div>
 <h2 className="text-3xl md:text-5xl font-extrabold text-foreground mb-6">
 {t('home.cap.title')}<span className="text-primary">{t('home.cap.title.highlight')}</span>
 </h2>
 <p className="text-base md:text-lg text-muted-foreground max-w-3xl mx-auto font-medium">
 {t('home.cap.desc')}
 </p>
 </div>

 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 sm:gap-6">
 {[
 { icon: MessageSquare, title: t('home.cap.f1.title'), desc: t('home.cap.f1.desc'), color: "text-[#12B76A]" },
 { icon: Phone, title: t('home.cap.f2.title'), desc: t('home.cap.f2.desc'), color: "text-primary" },
 { icon: Activity, title: t('home.cap.f3.title'), desc: t('home.cap.f3.desc'), color: "text-[#F04438]" },
 { icon: Store, title: t('home.cap.f4.title'), desc: t('home.cap.f4.desc'), color: "text-primary" },
 { icon: Wrench, title: t('home.cap.f5.title'), desc: t('home.cap.f5.desc'), color: "text-[#F79009]" },
 { icon: Briefcase, title: t('home.cap.f6.title'), desc: t('home.cap.f6.desc'), color: "text-[#12B76A]" },
 { icon: Users, title: t('home.cap.f7.title'), desc: t('home.cap.f7.desc'), color: "text-primary" },
 { icon: HardDrive, title: t('home.cap.f8.title'), desc: t('home.cap.f8.desc'), color: "text-foreground" }
 ].map((feat, i) => (
 <div key={i} className="block group h-full">
 <div className="relative flex h-full flex-col items-center overflow-hidden rounded-[16px] border border-border bg-card p-5 text-center card-shadow transition-all duration-200 hover:-translate-y-1">
 <div className={`w-12 h-12 rounded-[12px] bg-accent flex items-center justify-center mb-4 transition-transform duration-200`}>
 <feat.icon className={`w-6 h-6 ${feat.color}`} />
 </div>
 <h4 className="text-xs sm:text-sm font-bold text-foreground mb-1.5">{feat.title}</h4>
 <p className="text-[10px] text-muted-foreground leading-snug font-medium">{feat.desc}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </section>

 {/* Business Management Showcase */}
 <section className="py-24 bg-background relative overflow-hidden transition-colors duration-200 border-b border-border">
 <div className="container mx-auto px-4 sm:px-6 relative z-10">
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
 <div className="order-2 lg:order-1 lg:pr-8">
 <div className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-4">{t('home.biz.subtitle')}</div>
 <h2 className="text-4xl md:text-5xl font-extrabold text-foreground mb-6 leading-[1.1] whitespace-pre-line">
 {t('home.biz.title')}
 </h2>
 <p className="text-lg text-muted-foreground mb-10 leading-relaxed font-medium">
 {t('home.biz.desc')}
 </p>
 <Button asChild size="lg">
 <Link href="/features">
 {t('home.biz.btn')} <ArrowRight className="ml-2 w-5 h-5" />
 </Link>
 </Button>
 </div>

 <div className="relative flex justify-center lg:justify-end items-center order-1 lg:order-2 h-[500px] sm:h-[650px]">
 <div className="relative z-10 transform transition-transform duration-200">
 <DeviceMockup className="w-[240px] sm:w-[280px] h-[500px] sm:h-[600px] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)]">
 <ShopScreen />
 </DeviceMockup>
 </div>

 {/* Floating Feature Cards */}
 <div className="hidden md:flex flex-col gap-4 absolute right-[-5%] lg:right-[-2%] top-1/2 -translate-y-1/2 z-20 w-72">
 {[
 { icon: Users, title: t('home.biz.card1.title'), desc: t('home.biz.card1.desc') },
 { icon: Wrench, title: t('home.biz.card2.title'), desc: t('home.biz.card2.desc') },
 { icon: Briefcase, title: t('home.biz.card3.title'), desc: t('home.biz.card3.desc') },
 { icon: Users, title: t('home.biz.card4.title'), desc: t('home.biz.card4.desc') }
 ].map((item, i) => (
 <div key={i} className="flex cursor-default items-center gap-4 rounded-[12px] border border-border bg-card p-4 card-shadow transition-all duration-200">
 <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-accent`}>
 <item.icon className="w-5 h-5 text-primary" />
 </div>
 <div className="flex-1">
 <h5 className="text-sm font-bold text-foreground">{item.title}</h5>
 <p className="text-[11px] text-muted-foreground mt-0.5 font-medium">{item.desc}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </section>

 {/* Privacy/Security Showcase */}
  <section id="privacy-showcase" className="relative overflow-hidden border-b border-border bg-background py-24 transition-colors duration-200">
 <div className="container mx-auto px-4 sm:px-6 relative z-10">
 <div className="relative overflow-hidden rounded-[16px] border border-border bg-card p-8 card-shadow sm:p-12 lg:p-16">
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center relative z-10">
  <div className="lg:col-span-5 flex flex-col items-center lg:items-start text-center lg:text-left [container-type:inline-size]">
  <div className="relative mb-10 w-full max-w-[380px] overflow-hidden rounded-[24px] border border-white/60 bg-card/60 p-4 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.55)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/15 dark:bg-card/40" aria-label="Avarpus connected business tools">
  <div className="absolute inset-x-10 top-0 h-16 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
  <div className="relative grid grid-cols-4 gap-2" aria-hidden="true">
  {[
  { icon: Store, label: t('home.cap.f4.title'), color: 'border-amber-500/30 bg-amber-500/12 text-amber-600 dark:text-amber-400', delay: '0s' },
  { icon: Phone, label: t('home.cap.f2.title'), color: 'border-sky-500/30 bg-sky-500/12 text-sky-600 dark:text-sky-400', delay: '-4s' },
  { icon: MessageSquare, label: t('home.cap.f1.title'), color: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400', delay: '-8s' },
  { icon: BookOpenText, label: t('home.cap.f6.title'), color: 'border-violet-500/30 bg-violet-500/12 text-violet-600 dark:text-violet-400', delay: '-12s' }
  ].map((item) => (
  <div key={item.label} className="flex min-w-0 flex-col items-center gap-2">
  <div
  className={`security-capability-icon flex h-12 w-12 items-center justify-center rounded-2xl border ${item.color}`}
  style={{ animationDelay: item.delay }}
  >
  <item.icon className="h-5 w-5" strokeWidth={1.9} />
  </div>
  <span className="w-full truncate text-center text-[8px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">{item.label}</span>
  </div>
  ))}
  </div>

  <div className="relative mt-4 h-[88px] overflow-hidden rounded-[16px] border border-border/70 bg-background/55 px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
  {[
  { icon: Store, title: t('home.cap.f4.title'), desc: t('home.cap.f4.desc'), color: 'text-amber-600 dark:text-amber-400', delay: '0s' },
  { icon: Phone, title: t('home.cap.f2.title'), desc: t('home.cap.f2.desc'), color: 'text-sky-600 dark:text-sky-400', delay: '-4s' },
  { icon: MessageSquare, title: t('home.cap.f1.title'), desc: t('home.cap.f1.desc'), color: 'text-emerald-600 dark:text-emerald-400', delay: '-8s' },
  { icon: BookOpenText, title: t('home.cap.f6.title'), desc: t('home.cap.f6.desc'), color: 'text-violet-600 dark:text-violet-400', delay: '-12s' }
  ].map((item) => (
  <div
  key={item.title}
  className="security-capability-explanation absolute inset-0 flex items-center gap-3 px-4 py-3"
  style={{ animationDelay: item.delay }}
  aria-hidden="true"
  >
  <item.icon className={`h-5 w-5 shrink-0 ${item.color}`} strokeWidth={2} />
  <div className="min-w-0">
  <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-foreground">{item.title}</p>
  <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">{item.desc}</p>
  </div>
  </div>
  ))}
  </div>

  <ul className="sr-only">
  <li>{t('home.cap.f4.title')}: {t('home.cap.f4.desc')}</li>
  <li>{t('home.cap.f2.title')}: {t('home.cap.f2.desc')}</li>
  <li>{t('home.cap.f1.title')}: {t('home.cap.f1.desc')}</li>
  <li>{t('home.cap.f6.title')}: {t('home.cap.f6.desc')}</li>
  </ul>
  </div>
 <p className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-4">{t('home.sec.subtitle')}</p>
  <h2 className="mb-6 max-w-full text-[clamp(1.25rem,9cqi,2.5rem)] font-extrabold leading-[1.08] tracking-[-0.04em] text-foreground">
  {t('home.sec.title').split('\n').map((line) => (
  <span key={line} className="block whitespace-nowrap">{line}</span>
  ))}
 </h2>
 <p className="text-base sm:text-lg text-muted-foreground mb-10 leading-relaxed font-medium">
 {t('home.sec.desc')}
 </p>
 <Button asChild size="lg">
 <Link href="/security">
 {t('home.sec.btn')} <ArrowRight className="ml-2 w-4 h-4" />
 </Link>
 </Button>
 </div>

 <div className="lg:col-span-7">
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
 {[
 { icon: Lock, title: t('home.sec.f1.title'), desc: t('home.sec.f1.desc') },
 { icon: Shield, title: t('home.sec.f2.title'), desc: t('home.sec.f2.desc') },
 { icon: Settings, title: t('home.sec.f3.title'), desc: t('home.sec.f3.desc') },
 { icon: Activity, title: t('home.sec.f4.title'), desc: t('home.sec.f4.desc') }
 ].map((item, i) => (
 <div key={i} className="group flex items-center gap-4 rounded-[16px] border border-border bg-card p-6 card-shadow transition-all duration-200">
 <div className="w-12 h-12 rounded-[12px] bg-accent border border-border flex items-center justify-center shrink-0 transition-transform duration-200">
 <item.icon className="w-5 h-5 text-primary" />
 </div>
 <div>
 <h4 className="mb-1 text-sm font-bold text-foreground">{item.title}</h4>
 <p className="text-xs font-medium text-muted-foreground">{item.desc}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 </div>
 </div>
 </section>

 {/* Honest Value Strip */}
 <section className="py-16 bg-background border-b border-border transition-colors duration-200">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="grid grid-cols-2 md:grid-cols-4 gap-8 divide-x divide-border">
 <div className="flex flex-col items-center justify-center text-center px-4">
 <div className="w-12 h-12 flex items-center justify-center text-primary mb-2">
 <Smartphone className="w-8 h-8" />
 </div>
 <h4 className="text-sm sm:text-base font-bold text-foreground mb-1">{t('home.val.f1.title')}</h4>
 <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium">{t('home.val.f1.desc')}</p>
 </div>

 <div className="flex flex-col items-center justify-center text-center px-4">
 <div className="w-12 h-12 flex items-center justify-center text-primary mb-2">
 <Settings className="w-8 h-8" />
 </div>
 <h4 className="text-sm sm:text-base font-bold text-foreground mb-1">{t('home.val.f2.title')}</h4>
 <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium">{t('home.val.f2.desc')}</p>
 </div>

 <div className="flex flex-col items-center justify-center text-center px-4">
 <div className="w-12 h-12 flex items-center justify-center text-primary mb-2">
 <ShieldCheck className="w-8 h-8" />
 </div>
 <h4 className="text-sm sm:text-base font-bold text-foreground mb-1">{t('home.val.f3.title')}</h4>
 <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium">{t('home.val.f3.desc')}</p>
 </div>

 <div className="flex flex-col items-center justify-center text-center px-4">
 <div className="w-12 h-12 flex items-center justify-center text-primary mb-2">
 <Users className="w-8 h-8" />
 </div>
 <h4 className="text-sm sm:text-base font-bold text-foreground mb-1">{t('home.val.f4.title')}</h4>
 <p className="text-[10px] sm:text-[11px] text-muted-foreground font-medium">{t('home.val.f4.desc')}</p>
 </div>
 </div>
 </div>
 </section>

 {/* CTA Download Section */}
  <section id="india-business" className="relative overflow-hidden bg-background py-24 transition-colors duration-200 border-b border-border">
  <div className="absolute inset-0 bg-cover bg-center opacity-[0.90] dark:opacity-[0.70]" style={{ backgroundImage: `url(${heroBackground})` }} />

 <div className="container mx-auto px-4 sm:px-6 relative z-10">
  <div className="mx-auto mb-12 max-w-4xl p-6 text-center sm:p-8 md:mx-0 md:text-left lg:p-10">
  <h2 className="mb-6 text-4xl font-extrabold text-white [text-shadow:0_3px_20px_rgba(0,0,0,0.68)] md:text-5xl">
 {t('home.cta.title')}
 </h2>
  <p className="mx-auto mb-10 max-w-xl text-lg font-medium leading-relaxed text-white/85 [text-shadow:0_2px_14px_rgba(0,0,0,0.78)] md:mx-0 md:text-xl">
 {t('home.cta.desc')}
 </p>

 <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-6">
 <Button size="lg" className="sm:w-auto disabled:opacity-100" disabled>
 <Smartphone className="w-6 h-6 mr-3" />
 <span>{t('home.hero.btn.pending')}</span>
 </Button>
 </div>
 </div>
 </div>
 </section>
 </>
 );
}
