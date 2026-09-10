import { useState } from 'react';
import { PageMeta } from '@/components/page-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { usePublicRequestCreate } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { useLanguage } from '@/components/language-provider';

export default function DeleteAccount() {
 const [success, setSuccess] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const { t } = useLanguage();

 const mutation = usePublicRequestCreate();

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
 kind: 'account_deletion' as const,
 name: formData.get('name') as string,
 mobile: formData.get('mobile') as string,
 email: formData.get('email') as string,
 message: formData.get('message') as string,
 confirmation: formData.get('confirmation') === 'on',
 };

 if (!data.confirmation) {
 setError(t('del.form.error.noconfirm'));
 return;
 }

 mutation.mutate({ data }, {
 onSuccess: () => {
 setSuccess(true);
 },
 onError: (err: any) => {
 const status = err.status || err.response?.status;
 if (status === 429) {
 setError(t('del.form.error.429'));
 } else {
 setError(t('del.form.error.generic'));
 }
 }
 });
 };

 return (
 <>
 <PageMeta
 title={t('del.meta.title')}
 description={t('del.meta.desc')}
 path="/delete-account"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-2xl mx-auto">
 <div className="text-center md:text-left mb-10">
 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-red-500/10 border border-red-500/20 mb-6">
 <ShieldAlert className="w-8 h-8 text-red-500" />
 </div>
 <h1 className="text-4xl font-extrabold mb-4 text-foreground tracking-tight">{t('del.hero.title')}</h1>
 <p className="text-muted-foreground text-lg">{t('del.hero.desc')}</p>
 </div>

 <div className="bg-red-500/10 border border-red-500/20 rounded-[16px] p-6 md:p-8 mb-10">
 <div className="flex items-start gap-4">
 <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-1" />
 <div>
 <h3 className="font-bold text-lg mb-3 text-foreground">{t('del.info.title')}</h3>
 <ul className="list-disc pl-5 space-y-3 text-muted-foreground text-sm md:text-base leading-relaxed">
 <li>{t('del.info.l1')}</li>
 <li>{t('del.info.l2')}</li>
 <li>{t('del.info.l3')}</li>
 <li>{t('del.info.l4')}</li>
 <li>{t('del.info.l5')}</li>
 </ul>
 </div>
 </div>
 </div>

 {success ? (
 <div className="bg-card card-shadow p-10 text-center rounded-[16px] border border-emerald-600/20 dark:border-emerald-400/20">
 <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[12px] border border-emerald-600/20 bg-[#ECFDF3] text-[#12B76A] dark:border-emerald-400/20 dark:bg-emerald-950/30 dark:text-emerald-400">
 <CheckCircle2 className="w-10 h-10" />
 </div>
 <h2 className="text-2xl font-bold mb-4 text-foreground">{t('del.success.title')}</h2>
 <p className="text-muted-foreground text-lg mb-8 leading-relaxed max-w-md mx-auto">
 {t('del.success.desc')}
 </p>
 <Button asChild variant="outline" size="lg" className="rounded-[12px] border-border text-primary hover:text-primary/80 hover:bg-muted/50  px-8">
 <Link href="/">{t('del.success.btn')}</Link>
 </Button>
 </div>
 ) : (
 <form onSubmit={handleSubmit} className="bg-card card-shadow border border-border p-8 md:p-10 rounded-[16px] space-y-6">
 {error && (
 <div className="p-4 bg-red-500/10 text-red-500 text-sm rounded-xl border border-red-500/20 flex items-center gap-3">
 <div className="w-2 h-2 rounded-[12px] bg-red-500 shrink-0" />
 {error}
 </div>
 )}

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 <div className="space-y-2">
 <Label htmlFor="name" className="text-foreground">{t('del.form.name')}</Label>
 <Input id="name" name="name" required minLength={2} maxLength={100} placeholder={t('support.form.name.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>

 <div className="space-y-2">
 <Label htmlFor="mobile" className="text-foreground">{t('del.form.mobile')}</Label>
 <Input id="mobile" name="mobile" required pattern="^[6-9][0-9]{9}$" placeholder={t('support.form.mobile.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="email" className="text-foreground">{t('del.form.email')}</Label>
 <Input id="email" name="email" type="email" placeholder={t('del.form.email.ph')} className="bg-background border-border text-foreground h-12 rounded-xl focus-visible:ring-primary" />
 </div>

 <div className="space-y-2">
 <Label htmlFor="message" className="text-foreground">{t('del.form.reason')}</Label>
 <Textarea
 id="message"
 name="message"
 required
 minLength={10}
 maxLength={2000}
 placeholder={t('del.form.reason.ph')}
 className="min-h-[120px] bg-background border-border text-foreground rounded-xl focus-visible:ring-primary resize-none pt-4"
 />
 </div>

 {/* Honeypot field - invisible to users */}
 <div className="hidden" aria-hidden="true">
 <Label htmlFor="website">Website</Label>
 <Input id="website" name="website" tabIndex={-1} autoComplete="off" />
 </div>

 <div className="flex items-start gap-4 p-5 border border-border rounded-xl bg-background/50">
 <Checkbox id="confirmation" name="confirmation" required className="mt-1 border-muted-foreground data-[state=checked]:bg-primary data-[state=checked]:border-primary" />
 <Label htmlFor="confirmation" className="text-sm text-foreground font-normal leading-relaxed cursor-pointer">
 {t('del.form.confirm')}
 </Label>
 </div>

 <div className="pt-4">
 <Button type="submit" size="lg" className="w-full rounded-[12px]  bg-red-600 hover:bg-red-700 text-white font-bold text-base border-none card-shadow shadow-red-600/20" disabled={mutation.isPending}>
 {mutation.isPending ? t('del.form.submitting') : t('del.form.submit')}
 </Button>
 </div>
 </form>
 )}

 <div className="mt-10 text-center text-sm text-muted-foreground">
 {t('del.help')} <Link href="/support" className="text-primary hover:text-primary/80 hover:underline font-medium">{t('del.help.link')}</Link>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}