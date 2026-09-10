import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';
import { PageMeta } from '@/components/page-meta';
import { useLanguage } from '@/components/language-provider';

export default function NotFound() {
 const { t } = useLanguage();

 return (
 <>
 <PageMeta title={t('404.meta.title')} description={t('404.meta.desc')} />
 <div className="min-h-[70vh] flex items-center justify-center bg-background transition-colors duration-300">
 <div className="text-center">
 <div className="flex justify-center mb-6">
 <div className="w-20 h-20 bg-secondary rounded-[12px] flex items-center justify-center">
 <FileQuestion className="w-10 h-10 text-muted-foreground" />
 </div>
 </div>
 <h1 className="text-4xl font-bold mb-4 text-foreground">{t('404.title')}</h1>
 <p className="text-muted-foreground mb-8 max-w-md mx-auto">
 {t('404.desc')}
 </p>
 <Link href="/">
 <Button size="lg" className="px-8">{t('404.btn')}</Button>
 </Link>
 </div>
 </div>
 </>
 );
}