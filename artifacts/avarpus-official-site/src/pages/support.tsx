import { useState } from 'react';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Mail, MapPin, CheckCircle2, HelpCircle } from 'lucide-react';
import {
 getPublicContactGetQueryKey,
 usePublicContactGet,
 usePublicRequestCreate,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useLanguage } from '@/components/language-provider';

export default function Support() {
 const [success, setSuccess] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { t } = useLanguage();

 const mutation = usePublicRequestCreate();

 // The published address is operator-configured. If the API is unreachable the
 // page still shows the address baked into the site copy, never a blank slot.
 const { data: contact } = usePublicContactGet({
 query: { queryKey: getPublicContactGetQueryKey(), retry: false },
 });
 const supportEmail = contact?.supportEmail?.trim() || t('support.contact.email.val');

 const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 setError(null);

 const formData = new FormData(e.currentTarget);
 const website = formData.get('website') as string;

 // Honeypot check
 if (website) {
 setSuccess(true);
 return;
 }

 const data = {
 kind: 'support' as const,
 name: formData.get('name') as string,
 mobile: formData.get('mobile') as string,
 email: formData.get('email') as string,
 subject: formData.get('subject') as string,
 message: formData.get('message') as string,
 confirmation: false,
 };

 mutation.mutate({ data }, {
 onSuccess: () => {
 setSuccess(true);
 },
 onError: (err: any) => {
 const status = err.status || err.response?.status;
 if (status === 429) {
 setError(t('support.form.error.429'));
 } else {
 setError(t('support.form.error.generic'));
 }
 }
 });
 };

 return (
 <>
 <PageMeta
 title={t('support.meta.title')}
 description={t('support.meta.desc')}
 path="/support"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
 <div className="text-center max-w-3xl mx-auto mb-16">
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">{t('support.hero.title')}</h1>
 <p className="text-lg md:text-xl text-muted-foreground">
 {t('support.hero.desc')}
 </p>
 </div>

 <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
 {/* Contact Info */}
 <div className="lg:col-span-1 space-y-8">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <h3 className="text-xl font-bold mb-6 text-foreground">{t('support.contact.title')}</h3>

 <div className="space-y-6">
 <div className="flex items-start gap-4">
 <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
 <Mail className="w-5 h-5 text-primary" />
 </div>
 <div>
 <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-1">{t('support.contact.email.label')}</p>
 <a
 href={`mailto:${supportEmail}`}
 className="text-sm text-foreground hover:text-primary transition-colors break-all"
 data-testid="link-support-email"
 >
 {supportEmail}
 </a>
 </div>
 </div>

 <div className="flex items-start gap-4">
 <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
 <MapPin className="w-5 h-5 text-primary" />
 </div>
 <div>
 <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-1">{t('support.contact.office.label')}</p>
 <address className="text-muted-foreground not-italic italic text-sm leading-relaxed">
 {t('support.contact.office.val')}
 </address>
 </div>
 </div>
 </div>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px]">
 <div className="flex items-center gap-3 mb-6">
 <HelpCircle className="w-6 h-6 text-primary" />
 <h3 className="text-lg font-bold text-foreground">{t('support.faq.title')}</h3>
 </div>
 <ul className="space-y-4 text-sm">
 <li><Link href="/features" className="text-primary hover:text-primary/80 hover:underline transition-colors">{t('support.faq.q1')}</Link></li>
 <li><Link href="/security" className="text-primary hover:text-primary/80 hover:underline transition-colors">{t('support.faq.q2')}</Link></li>
 <li><Link href="/about" className="text-primary hover:text-primary/80 hover:underline transition-colors">{t('support.faq.q3')}</Link></li>
 </ul>
 </div>
 </div>

 {/* Contact Form */}
 <div className="lg:col-span-2">
 {success ? (
 <div className="bg-card card-shadow border border-emerald-600/20 dark:border-emerald-400/20 p-12 text-center rounded-[16px] h-full flex flex-col justify-center items-center">
 <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-[12px] border border-emerald-600/20 bg-[#ECFDF3] text-[#12B76A] dark:border-emerald-400/20 dark:bg-emerald-950/30 dark:text-emerald-400">
 <CheckCircle2 className="w-10 h-10" />
 </div>
 <h2 className="text-3xl font-extrabold mb-4 text-foreground">{t('support.form.success.title')}</h2>
 <p className="text-muted-foreground text-lg mb-8 max-w-md">
 {t('support.form.success.desc')}
 </p>
 <Button variant="outline" className="rounded-[12px] border-border text-primary hover:text-primary/80 hover:bg-muted/50" onClick={() => setSuccess(false)}>
 {t('support.form.success.btn')}
 </Button>
 </div>
 ) : (
 <form onSubmit={handleSubmit} className="bg-card card-shadow border border-border p-8 md:p-10 rounded-[16px] space-y-6">
 <h2 className="text-2xl font-bold mb-2 text-foreground">{t('support.form.title')}</h2>
 <p className="text-sm text-muted-foreground mb-6">{t('support.form.desc')}</p>

 {error && (
 <div className="p-4 bg-red-500/10 text-red-500 text-sm rounded-xl border border-red-500/20 flex items-center gap-3">
 <div className="w-2 h-2 rounded-[12px] bg-red-500 shrink-0" />
 {error}
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="space-y-2">
 <Label htmlFor="name" className="text-foreground">{t('support.form.name')}</Label>
 <Input id="name" name="name" required minLength={2} maxLength={100} placeholder={t('support.form.name.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>

 <div className="space-y-2">
 <Label htmlFor="mobile" className="text-foreground">{t('support.form.mobile')}</Label>
 <Input id="mobile" name="mobile" required pattern="^[6-9][0-9]{9}$" placeholder={t('support.form.mobile.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="email" className="text-foreground">{t('support.form.email')}</Label>
 <Input id="email" name="email" type="email" placeholder={t('support.form.email.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>

 <div className="space-y-2">
 <Label htmlFor="subject" className="text-foreground">{t('support.form.subject')}</Label>
 <Input id="subject" name="subject" maxLength={120} placeholder={t('support.form.subject.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>

 <div className="space-y-2">
 <Label htmlFor="message" className="text-foreground">{t('support.form.msg')}</Label>
 <Textarea
 id="message"
 name="message"
 required
 minLength={10}
 maxLength={2000}
 placeholder={t('support.form.msg.ph')}
 className="min-h-[150px] bg-background border-border text-foreground rounded-xl focus-visible:ring-primary resize-none pt-4"
 />
 </div>

 {/* Honeypot field - invisible to users */}
 <div className="hidden" aria-hidden="true">
 <Label htmlFor="website">Website</Label>
 <Input id="website" name="website" tabIndex={-1} autoComplete="off" />
 </div>

 <div className="pt-2">
 <Button type="submit" size="lg" className="w-full rounded-[12px] bg-primary px-8 text-base font-bold text-primary-foreground sm:w-auto" disabled={mutation.isPending}>
 {mutation.isPending ? t('support.form.submitting') : t('support.form.submit')}
 </Button>
 </div>
 </form>
 )}
 </div>
 </div>
 </div>
 </div>
 </>
 );
}