import { PageMeta } from '@/components/page-meta';
import { Smartphone, Apple, ShieldCheck, Download as DownloadIcon } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';

const API_ORIGIN = (import.meta.env.VITE_API_URL || 'https://api.avarpus.com').replace(/\/+$/, '');
const DIRECT_APK_URL = `${API_ORIGIN}/api/app-updates/public/latest/apk`;

export default function Download() {
 const { language } = useLanguage();

 return (
 <>
 <PageMeta
 title={language === 'hi' ? "Avarpus डाउनलोड करें" : "Download Avarpus"}
 description={language === 'hi' ? "भारतीय मरम्मत व्यवसायों के लिए Avarpus ऐप प्राप्त करें।" : "Get the Avarpus app for Indian repair businesses."}
 path="/download"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-4xl mx-auto text-center">

 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-accent border border-border mb-6">
 <DownloadIcon className="w-8 h-8 text-primary" />
 </div>

 <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-foreground tracking-tight">
 {language === 'hi' ? "ऐप प्राप्त करें" : "Get the App"}
 </h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto mb-16">
 {language === 'hi'
 ? "Avarpus का नवीनतम प्रकाशित Android APK नीचे दिए गए सीधे डाउनलोड विकल्प से उपलब्ध है। iOS सार्वजनिक चैनल की घोषणा अभी नहीं हुई है।"
 : "The latest published Avarpus Android APK is available through the direct download option below. An iOS public channel has not been announced."}
 </p>
 <p className="-mt-10 mb-16 max-w-2xl mx-auto text-sm leading-relaxed text-muted-foreground">
 {language === 'hi'
 ? "कॉलिंग, कैमरा या स्कैनर, बायोमेट्रिक ऐप लॉक और ऐप अपडेट समर्थित नेटिव बिल्ड, डिवाइस अनुमतियों, रिलीज़ कॉन्फ़िगरेशन और सक्षम सेवाओं पर निर्भर करते हैं।"
 : "Calling, camera or scanner access, biometric app lock, and app updates depend on supported native builds, device permissions, release configuration, and enabled services."}
 </p>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16 text-left">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col items-center justify-center relative overflow-hidden group">
 <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
 <Smartphone className="w-24 h-24 text-foreground" />
 </div>
 <Smartphone className="w-12 h-12 text-[#12B76A] dark:text-[#12B76A] mb-6 relative z-10" />
 <h3 className="text-2xl font-bold text-foreground mb-2 relative z-10">Android</h3>
 <p className="text-muted-foreground text-sm mb-8 relative z-10">
 {language === 'hi' ? "प्रकाशित APK उपलब्ध है" : "Published APK available"}
 </p>
 <div className="w-full h-14 rounded-[16px] bg-muted text-foreground font-bold border border-border relative z-10 flex items-center justify-center opacity-70">
 {language === 'hi' ? "सीधे डाउनलोड विकल्प का उपयोग करें" : "Use the direct download option"}
 </div>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col items-center justify-center relative overflow-hidden group">
 <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
 <DownloadIcon className="w-24 h-24 text-foreground" />
 </div>
 <DownloadIcon className="w-12 h-12 text-primary mb-6 relative z-10" />
 <h3 className="text-2xl font-bold text-foreground mb-2 relative z-10">
 {language === 'hi' ? "सीधा डाउनलोड" : "Direct Download"}
 </h3>
 <p className="text-muted-foreground text-sm mb-8 relative z-10 text-center">
 {language === 'hi' ? "नवीनतम प्रकाशित Android APK" : "Latest published Android APK"}
 </p>
 <a
 href={DIRECT_APK_URL}
 className="w-full min-h-14 rounded-[16px] bg-primary text-primary-foreground font-bold border border-primary relative z-10 flex items-center justify-center gap-2 px-4 text-center transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
 download
 >
 <DownloadIcon className="w-5 h-5" />
 {language === 'hi' ? "Avarpus APK डाउनलोड करें" : "Download Avarpus APK"}
 </a>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col items-center justify-center relative overflow-hidden group opacity-50">
 <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
 <Apple className="w-24 h-24 text-foreground" />
 </div>
 <Apple className="w-12 h-12 text-muted-foreground mb-6 relative z-10" />
 <h3 className="text-2xl font-bold text-foreground mb-2 relative z-10">iOS</h3>
 <p className="text-muted-foreground text-sm mb-8 relative z-10">
 {language === 'hi' ? "सार्वजनिक चैनल की घोषणा नहीं हुई है" : "Public channel not announced"}
 </p>
 <div className="w-full h-14 rounded-[16px] bg-muted text-muted-foreground font-bold border border-border relative z-10 flex items-center justify-center px-4 text-center text-sm">
 {language === 'hi' ? "iOS उपलब्धता और सार्वजनिक चैनल की घोषणा नहीं की गई है" : "iOS availability and public channel have not been announced"}
 </div>
 </div>
 </div>

 <div className="bg-background border border-border p-8 md:p-10 rounded-[16px] text-left flex flex-col md:flex-row items-center gap-8 shadow-sm max-w-3xl mx-auto">
 <div className="w-16 h-16 rounded-[12px] bg-accent flex items-center justify-center shrink-0 border border-border">
 <ShieldCheck className="w-8 h-8 text-primary" />
 </div>
 <div className="flex-1">
 <h3 className="text-xl font-bold text-foreground mb-2">
 {language === 'hi' ? "सुरक्षित इंस्टॉलेशन" : "Secure Installation"}
 </h3>
 <p className="text-muted-foreground text-sm leading-relaxed">
 {language === 'hi'
 ? "कृपया केवल आधिकारिक तौर पर प्रदान किए गए लिंक और चैनलों से ही Avarpus डाउनलोड करें। तृतीय-पक्ष स्रोतों से अनधिकृत APK पर भरोसा न करें।"
 : "Please only download Avarpus from officially provided links and channels. Do not trust unauthorized APKs from third-party sources."}
 </p>
 </div>
 </div>

 </div>
 </div>
 </div>
 </>
 );
}