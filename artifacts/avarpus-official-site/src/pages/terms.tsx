import { PageMeta } from '@/components/page-meta';
import { useLanguage } from '@/components/language-provider';

function TermsEn() {
 return (
 <div className="prose prose-blue max-w-none dark:prose-invert prose-p:text-muted-foreground prose-li:text-muted-foreground prose-a:text-primary hover:prose-a:text-primary/80">
 <p className="lead text-muted-foreground font-medium">
 Product notice updated: September 9, 2026
 </p>

 <p>
 Welcome to Avarpus. This notice describes expected use of the pre-release application and related services. It is limited to current product behavior and is not a substitute for operator-specific legal terms.
 </p>

 <h2>1. Account Control</h2>
 <p>
 You are responsible for safeguarding your login credentials (OTP access and trusted devices) and for activities that occur under your account. Avarpus app lock uses supported biometric/device credentials, not MPIN or app-level encryption.
 </p>

 <h2>2. Responsible Use</h2>
 <p>You agree to use Avarpus responsibly, including NOT to:</p>
 <ul>
 <li>Distribute spam, bulk messages, or engage in unsolicited advertising.</li>
 <li>Harass, abuse, or harm another person.</li>
 <li>Impersonate any person or business entity.</li>
 <li>Interfere with or disrupt the integrity or performance of the app.</li>
 </ul>

 <h2>3. Business Operations</h2>
 <p>
 If you are a shop owner or dealer, you are responsible for the actions of the staff accounts you create. Features vary by role, shop membership, permissions, and configuration.
 </p>

 <h2>4. Messaging</h2>
 <p>
 Messages are stored on servers to support delivery, conversation history, and multi-device access. Messages are not end-to-end encrypted. Access is restricted by authenticated room membership and server authorization; platform infrastructure may technically process stored content.
 </p>

 <h2>5. Shop Features and Ledgers</h2>
 <p>
 Avarpus provides tools for repair tracking, inventory, and Khata (ledgers). We are not a financial institution, and the ledger features are strictly for operational record-keeping. Any payments recorded in Avarpus (payments, advances, dues, refunds) are agreements between you and your customers or dealers. Avarpus records these transactions but is not represented as holding or transferring funds.
 </p>

 <h2>6. Account Deletion</h2>
 <p>
 Account deletion is request-only, requires identity verification, and is not instant. Certain operational records may be retained as required by applicable obligations.
 </p>
 </div>
 );
}

function TermsHi() {
 return (
 <div className="prose prose-blue max-w-none dark:prose-invert prose-p:text-muted-foreground prose-li:text-muted-foreground prose-a:text-primary hover:prose-a:text-primary/80">
 <p className="lead text-muted-foreground font-medium">
 उत्पाद सूचना अद्यतन: 9 सितंबर, 2026
 </p>

 <p>
 Avarpus में आपका स्वागत है। यह सूचना प्री-रिलीज़ एप्लिकेशन और संबंधित सेवाओं के अपेक्षित उपयोग का वर्णन करती है। यह वर्तमान उत्पाद व्यवहार तक सीमित है और ऑपरेटर-विशिष्ट कानूनी शर्तों का विकल्प नहीं है।
 </p>

 <h2>1. खाता नियंत्रण</h2>
 <p>
 आप अपने लॉगिन क्रेडेंशियल्स (OTP एक्सेस और विश्वसनीय डिवाइस) की सुरक्षा के लिए और अपने खाते के तहत होने वाली गतिविधियों के लिए जिम्मेदार हैं। Avarpus ऐप लॉक समर्थित बायोमेट्रिक/डिवाइस क्रेडेंशियल्स का उपयोग करता है, न कि MPIN या ऐप-स्तरीय एन्क्रिप्शन का।
 </p>

 <h2>2. जिम्मेदार उपयोग</h2>
 <p>आप Avarpus का जिम्मेदारी से उपयोग करने के लिए सहमत हैं, जिसमें निम्नलिखित नहीं करना शामिल है:</p>
 <ul>
 <li>स्पैम, थोक संदेश वितरित करना, या अवांछित विज्ञापन में संलग्न होना।</li>
 <li>किसी अन्य व्यक्ति को परेशान करना, दुर्व्यवहार करना या नुकसान पहुंचाना।</li>
 <li>किसी भी व्यक्ति या व्यावसायिक इकाई का प्रतिरूपण करना।</li>
 <li>ऐप की अखंडता या प्रदर्शन में हस्तक्षेप करना या बाधित करना।</li>
 </ul>

 <h2>3. व्यवसाय संचालन</h2>
 <p>
 यदि आप दुकान के मालिक या डीलर हैं, तो आप अपने द्वारा बनाए गए स्टाफ खातों की कार्रवाई के लिए जिम्मेदार हैं। सुविधाएँ भूमिका, दुकान सदस्यता, अनुमतियों और कॉन्फ़िगरेशन के अनुसार भिन्न होती हैं।
 </p>

 <h2>4. मैसेजिंग</h2>
 <p>
 संदेश डिलीवरी, वार्तालाप इतिहास और मल्टी-डिवाइस एक्सेस के लिए सर्वर पर संग्रहीत होते हैं। संदेश एंड-टू-एंड एन्क्रिप्टेड नहीं हैं। एक्सेस प्रमाणित रूम सदस्यता और सर्वर प्राधिकरण तक सीमित है; प्लेटफ़ॉर्म इन्फ्रास्ट्रक्चर संग्रहीत सामग्री को तकनीकी रूप से संसाधित कर सकता है।
 </p>

 <h2>5. दुकान की सुविधाएँ और लेजर</h2>
 <p>
 Avarpus मरम्मत ट्रैकिंग, इन्वेंट्री और खाता (लेजर) के लिए उपकरण प्रदान करता है। हम कोई वित्तीय संस्थान नहीं हैं, और लेजर सुविधाएँ सख्ती से परिचालन रिकॉर्ड रखने के लिए हैं। Avarpus में रिकॉर्ड किया गया कोई भी भुगतान (भुगतान, अग्रिम, बकाया, रिफंड) आपके और आपके ग्राहकों या डीलरों के बीच समझौते हैं। Avarpus इन लेनदेनों को रिकॉर्ड करता है लेकिन इसे धन रखने या स्थानांतरित करने के रूप में प्रस्तुत नहीं किया जाता है।
 </p>

 <h2>6. खाता हटाना</h2>
 <p>
 खाता हटाना केवल अनुरोध-आधारित है, इसके लिए पहचान सत्यापन की आवश्यकता होती है, और यह तत्काल नहीं है। लागू दायित्वों के अनुसार कुछ परिचालन रिकॉर्ड को बनाए रखा जा सकता है।
 </p>
 </div>
 );
}

export default function Terms() {
 const { language } = useLanguage();

 return (
 <>
 <PageMeta
 title={language === 'hi' ? "प्री-रिलीज़ सेवा उपयोग सूचना - Avarpus" : "Pre-release Service Use Notice - Avarpus"}
 description={language === 'hi' ? "Avarpus प्री-रिलीज़ सेवा उपयोग सूचना।" : "Avarpus Pre-release Service Use Notice."}
 path="/terms"
 />

 <div className="pt-32 pb-24 bg-background transition-colors duration-300 min-h-[100dvh]">
 <div className="container mx-auto px-4">
 <div className="max-w-3xl mx-auto bg-card card-shadow border border-border p-8 md:p-12 rounded-[16px]">
 <h1 className="text-4xl font-bold mb-8 text-foreground">
 {language === 'hi' ? "प्री-रिलीज़ सेवा उपयोग सूचना" : "Pre-release Service Use Notice"}
 </h1>
 {language === 'hi' ? <TermsHi /> : <TermsEn />}
 </div>
 </div>
 </div>
 </>
 );
}