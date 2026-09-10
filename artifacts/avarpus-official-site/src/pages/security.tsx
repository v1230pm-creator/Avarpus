import { PageMeta } from '@/components/page-meta';
import { ShieldAlert, Server, LockKeyhole, EyeOff, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';

export default function Security() {
 const { language } = useLanguage();

 return (
 <>
 <PageMeta
 title={language === 'hi' ? "सुरक्षा सिद्धांत" : "Security Principles"}
 description={language === 'hi' ? "Avarpus में डेटा सुरक्षा और गोपनीयता के प्रति हमारा पारदर्शी दृष्टिकोण।" : "Our transparent approach to data security and privacy at Avarpus."}
 path="/security"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6 max-w-4xl">
 <div className="mb-16 text-center md:text-left">
 <div className="inline-flex items-center justify-center w-16 h-16 rounded-[16px] bg-indigo-600/10 dark:bg-indigo-400/10 border border-border dark:border-border mb-6">
 <ShieldCheck className="w-8 h-8 text-primary dark:text-primary" />
 </div>
 <h1 className="text-4xl md:text-5xl font-extrabold mb-6 text-foreground tracking-tight">
 {language === 'hi' ? "सुरक्षा सिद्धांत" : "Security Principles"}
 </h1>
 <p className="text-lg md:text-xl text-muted-foreground">
 {language === 'hi'
 ? "यहाँ प्रमुख Avarpus सुरक्षा और डेटा-हैंडलिंग प्रथाओं का अवलोकन दिया गया है, जिसमें महत्वपूर्ण सीमाएँ शामिल हैं।"
 : "Here is an overview of key Avarpus security and data-handling practices, including important limitations."}
 </p>
 </div>

 <div className="space-y-6">
 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col md:flex-row gap-6 md:gap-8 items-start hover:bg-muted transition-colors">
 <div className="shrink-0">
 <div className="w-12 h-12 rounded-xl bg-background flex items-center justify-center border border-border">
 <EyeOff className="w-6 h-6 text-muted-foreground" />
 </div>
 </div>
 <div>
 <h3 className="text-xl font-bold mb-3 text-foreground">
 {language === 'hi' ? "संपर्क मिलान" : "Contact Matching"}
 </h3>
 <p className="text-muted-foreground leading-relaxed text-base">
 {language === 'hi'
 ? "मोबाइल ऐप द्वारा अनुमति देने के बाद सबमिट की गई संपर्क जानकारी का उपयोग संपर्क मिलान के लिए किया जा सकता है। सर्वर सबमिट किए गए नंबरों का उपयोग योग्य मिलान खोजने के लिए करता है; ब्लॉक किए गए जोड़ों का मिलान नहीं किया जाता।"
 : "Contact matching may use contact information submitted by the mobile app after you grant permission. The server uses submitted numbers to find eligible matches and excludes blocked pairs."}
 </p>
 </div>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col md:flex-row gap-6 md:gap-8 items-start hover:bg-muted transition-colors">
 <div className="shrink-0">
 <div className="w-12 h-12 rounded-xl bg-background flex items-center justify-center border border-border">
 <Server className="w-6 h-6 text-primary dark:text-primary" />
 </div>
 </div>
 <div>
 <h3 className="text-xl font-bold mb-3 text-foreground">
 {language === 'hi' ? "डेटा स्कोप" : "Data Scope"}
 </h3>
 <p className="text-muted-foreground leading-relaxed text-base">
 {language === 'hi'
 ? "सर्वर दुकान और डीलर संबंधों द्वारा एक्सेस की जांच करता है। स्टाफ सदस्य केवल वही देखते हैं जिसकी उनकी निर्दिष्ट भूमिका अनुमति देती है। हम व्यापार रिकॉर्ड के लिए API स्तर पर इन सीमाओं को लागू करते हैं।"
 : "Server checks scope access by shop and dealer relationship. Staff members only see what their assigned role permits. We enforce these boundaries at the API level for business records."}
 </p>
 </div>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col md:flex-row gap-6 md:gap-8 items-start hover:bg-muted transition-colors">
 <div className="shrink-0">
 <div className="w-12 h-12 rounded-xl bg-background flex items-center justify-center border border-border">
 <LockKeyhole className="w-6 h-6 text-[#12B76A] dark:text-[#12B76A]" />
 </div>
 </div>
 <div>
 <h3 className="text-xl font-bold mb-3 text-foreground">
 {language === 'hi' ? "संरक्षित बैकअप" : "Protected Backups"}
 </h3>
 <p className="text-muted-foreground leading-relaxed text-base">
 {language === 'hi'
 ? "संदेश डिलीवरी, वार्तालाप इतिहास और मल्टी-डिवाइस एक्सेस के लिए सर्वर पर संग्रहीत होते हैं। वर्तमान कोड कोई सामान्य चैट-प्रतिधारण अवधि या गारंटीकृत हटाने की समय-सारणी स्थापित नहीं करता। Google ड्राइव कॉन्फ़िगर होने पर आप अपने चुने हुए रिकवरी पासवर्ड से अपलोड से पहले सुरक्षित मैन्युअल, ऑप्ट-इन चैट बैकअप बना सकते हैं। यह पूर्ण एप्लिकेशन-डेटा बैकअप नहीं है और वर्तमान रिकवरी चैट को लाइव रूम में आयात नहीं करती।"
 : "Messages are stored on servers to support delivery, conversation history, and multi-device access. Current code does not establish a general chat-retention period or guaranteed deletion schedule. When Google Drive is configured, you can manually create an opt-in chat backup protected before upload with a recovery password you choose. This is not a full application-data backup, and current recovery does not import chats back into live rooms."}
 </p>
 </div>
 </div>

 <div className="bg-card card-shadow border border-border p-8 rounded-[16px] flex flex-col md:flex-row gap-6 md:gap-8 items-start hover:bg-muted transition-colors">
 <div className="shrink-0">
 <div className="w-12 h-12 rounded-xl bg-background flex items-center justify-center border border-border">
 <ShieldAlert className="w-6 h-6 text-red-500" />
 </div>
 </div>
 <div>
 <h3 className="text-xl font-bold mb-3 text-foreground">
 {language === 'hi' ? "ईमानदार दावे" : "Honest Claims"}
 </h3>
 <p className="text-muted-foreground leading-relaxed text-base">
 {language === 'hi'
 ? "हम कोई पूर्ण सुरक्षा गारंटी नहीं देते। Avarpus प्रमाणित सत्र, सर्वर-लागू भूमिकाएँ और एक्सेस नियंत्रण उपयोग करता है। संदेश एंड-टू-एंड एन्क्रिप्टेड (E2EE) नहीं हैं और चैट एक्सेस प्रमाणित रूम सदस्यता तथा सर्वर प्राधिकरण तक सीमित है।"
 : "We do not make absolute security guarantees. Avarpus uses authenticated sessions, server-enforced roles, and access controls. Messages are not End-to-End Encrypted (E2EE), and chat access is restricted by authenticated room membership and server authorization."}
 </p>
 </div>
 </div>
 </div>
 </div>
 </div>
 </>
 );
}