import { PageMeta } from '@/components/page-meta';
import { Target, Zap, Users, Store, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export default function About() {
 const { language } = useLanguage();

 return (
 <>
 <PageMeta
 title={language === 'hi' ? "Avarpus के बारे में" : "About Avarpus"}
 description={language === 'hi' ? "Avarpus भारतीय मरम्मत व्यवसायों के लिए पेशेवर उपकरण प्रदान करता है।" : "Avarpus provides professional tools for Indian repair businesses."}
 path="/about"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-4xl mx-auto">
 <div className="text-center mb-16">
 <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold mb-6 text-foreground tracking-tight">
 {language === 'hi' ? "मरम्मत के व्यवसाय के लिए निर्मित" : "Built for the Business of Repair"}
 </h1>
 <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
 {language === 'hi'
 ? "Avarpus कैज़ुअल संचार और संचालन के बीच की खाई को पाटता है। हम वे उपकरण प्रदान करते हैं जिनकी भारतीय मरम्मत की दुकानों को अपना व्यवसाय व्यवस्थित करने के लिए आवश्यकता होती है।"
 : "Avarpus bridges the gap between casual communication and operations. We provide the tools Indian repair shops need to organize their business."}
 </p>
 </div>

 <div className="bg-card card-shadow border border-border rounded-[16px] p-8 md:p-12 mb-16 relative overflow-hidden">
 <div className="absolute top-0 right-0 p-8 opacity-5">
 <Store className="w-64 h-64 text-foreground" />
 </div>
 <div className="relative z-10 max-w-2xl">
 <h2 className="text-3xl font-bold text-foreground mb-6">
 {language === 'hi' ? "हमारा मिशन" : "Our Mission"}
 </h2>
 <p className="text-muted-foreground text-lg leading-relaxed mb-6">
 {language === 'hi'
 ? "बहुत लंबे समय से, मरम्मत की दुकानें पेपर टिकटों, व्यक्तिगत मैसेजिंग ऐप्स और सामान्य लेजर के मिश्रण पर निर्भर रही हैं। यह व्यक्तिगत जीवन और व्यवसाय के बीच एक अव्यवस्थित सीमा बनाता है।"
 : "For too long, repair shops have relied on a mix of paper tickets, personal messaging apps, and generic ledgers. This creates a messy boundary between personal life and business."}
 </p>
 <p className="text-muted-foreground text-lg leading-relaxed">
 {language === 'hi'
 ? "Avarpus एक समर्पित, कनेक्टेड वर्कस्पेस प्रदान करने के लिए मौजूद है। सर्वर-स्टोर्ड चैट को शॉप-स्कोप ऑपरेशन्स—जैसे रिपेयर ट्रैकिंग, स्टाफ रोल और डिजिटल खाता—के साथ जोड़कर, हम व्यवसायों को स्पष्टता के साथ काम करने में सक्षम बनाते हैं।"
 : "Avarpus exists to provide a dedicated, connected workspace. By combining server-stored chat with shop-scoped operations—like repair tracking, staff roles, and digital khata—we enable businesses to operate with clarity."}
 </p>
 </div>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] text-center">
 <Target className="w-10 h-10 text-primary dark:text-primary mx-auto mb-4" />
 <h3 className="text-xl font-bold text-foreground mb-3">
 {language === 'hi' ? "फोकस" : "Focus"}
 </h3>
 <p className="text-muted-foreground text-sm leading-relaxed">
 {language === 'hi'
 ? "संपर्क मिलान पंजीकृत Avarpus खातों की पहचान करने के लिए फोन नंबरों को सामान्य करता है; यह वास्तविक दुनिया की पहचान को सत्यापित नहीं करता है।"
 : "Contact matching normalizes phone numbers to identify registered Avarpus accounts; it does not verify real-world identity."}
 </p>
 </div>
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] text-center">
 <Users className="w-10 h-10 text-primary dark:text-primary mx-auto mb-4" />
 <h3 className="text-xl font-bold text-foreground mb-3">
 {language === 'hi' ? "भूमिकाएँ" : "Roles"}
 </h3>
 <p className="text-muted-foreground text-sm leading-relaxed">
 {language === 'hi'
 ? "मालिक-नियंत्रित अनुमतियां दुकान की भूमिकाओं और जिम्मेदारियों के आधार पर पहुंच को सीमित करती हैं।"
 : "Owner-controlled permissions scope access based on shop roles and responsibilities."}
 </p>
 </div>
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] text-center">
 <Zap className="w-10 h-10 text-[#12B76A] dark:text-[#12B76A] mx-auto mb-4" />
 <h3 className="text-xl font-bold text-foreground mb-3">
 {language === 'hi' ? "एकीकरण" : "Integration"}
 </h3>
 <p className="text-muted-foreground text-sm leading-relaxed">
 {language === 'hi'
 ? "संचालन को सुव्यवस्थित करने के लिए एक ही वातावरण में चैट करें, कॉल करें, ट्रैक करें और लेजर रिकॉर्ड करें।"
 : "Chat, call, track, and record ledgers in one environment to streamline operations."}
 </p>
 </div>
 </div>

 <div className="bg-background border border-border p-8 md:p-10 rounded-[16px] text-left flex flex-col md:flex-row items-center gap-8 shadow-sm">
 <div className="w-16 h-16 rounded-[12px] bg-accent flex items-center justify-center shrink-0 border border-border">
 <ShieldCheck className="w-8 h-8 text-primary" />
 </div>
 <div className="flex-1">
 <h3 className="text-xl font-bold text-foreground mb-2">
 {language === 'hi' ? "शॉप-स्कोप संचालन" : "Shop-Scoped Operations"}
 </h3>
 <p className="text-muted-foreground text-sm leading-relaxed mb-4">
 {language === 'hi'
 ? "Avarpus सर्वर दुकान और डीलर संबंधों द्वारा एक्सेस की जांच करता है, OTP के माध्यम से नियंत्रण प्रमाणित करता है, और मालिक-नियंत्रित भूमिकाओं के माध्यम से पहुंच को प्रतिबंधित करता है।"
 : "Avarpus server checks scope access by shop and dealer relationship, authenticates control via OTP, and restricts access through owner-controlled roles."}
 </p>
 <Link href="/security" className="text-primary hover:text-primary/80 font-medium hover:underline text-sm inline-flex items-center">
 {language === 'hi' ? "हमारे सुरक्षा सिद्धांत पढ़ें" : "Read our security principles"}
 </Link>
 </div>
 </div>

 </div>
 </div>
 </div>
 </>
 );
}