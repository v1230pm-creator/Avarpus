import { PageMeta } from '@/components/page-meta';
import { Link } from 'wouter';
import { useLanguage } from '@/components/language-provider';

function PrivacyEn() {
 return (
 <div className="prose prose-blue max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-a:text-primary hover:prose-a:text-primary/80">
 <p className="lead text-muted-foreground font-medium tracking-wide">
 Product notice updated: September 9, 2026
 </p>

 <p>
 Welcome to Avarpus. This Pre-release Privacy Notice outlines the current technical data handling for the Avarpus application and related services. Operator-specific legal details and the effective date will be published before public commercial release.
 </p>

 <h2>1. Information handled by the service</h2>
 <p>The service handles information needed for account access, communication, and repair-business operations.</p>

 <h3>A. Account, profile, and session information</h3>
 <ul>
 <li><strong>Phone Number:</strong> Used to create an account and verify control via OTP.</li>
 <li><strong>Profile Information:</strong> The name, business details, and profile photo you provide.</li>
 <li><strong>Access Information:</strong> Sessions, shop memberships, roles, permissions, and supported trusted-device recovery records.</li>
 </ul>

 <h3>B. Shop and operational information</h3>
 <ul>
 <li><strong>Shop and people records:</strong> Shop settings, staff, customers, B2B dealers, suppliers, and related contact details.</li>
 <li><strong>Repair records:</strong> Intake details, devices, diagnoses, work, parts, photos, testing, estimates, approvals, delivery details, signatures, warranties, returns, and refunds.</li>
 <li><strong>Business records:</strong> Inventory, purchases, finance entries, Khata entries, recorded payments, advances, dues, reports, and notifications.</li>
 </ul>

 <h3>C. Communication and content</h3>
 <p>
 The service handles messages, attachments, read state, caller-specific chat preferences, blocks, reports, Status posts and viewers, and configured call metadata. Messages are processed and stored on servers to support delivery, conversation history, and multi-device access. Avarpus messages are not End-to-End Encrypted (E2EE). App access is limited to authenticated room members; platform infrastructure, operators, and processors may technically process stored content to operate and secure the service.
 </p>

 <h3>D. Contacts and Permissions</h3>
 <p>
 Contact matching may use contact information submitted by the mobile app after you grant permission. The server uses submitted numbers to find eligible matches; matching is excluded for blocked pairs. We have not established that names or images are sent for matching.
 </p>

 <h3>E. Technical, audit, and request information</h3>
 <p>
 The service handles device and network identifiers, IP addresses, app and error logs, audit events, abuse-prevention records, and metadata submitted with public support or deletion requests. Trusted-device recovery uses hashed Android secure identifiers.
 </p>

 <h2>2. How Information is Used</h2>
 <p>Information is used to:</p>
 <ul>
 <li>Authenticate accounts, maintain sessions, and support account recovery controls.</li>
 <li>Run repair, customer, dealer, inventory, purchase, finance, Khata, return, refund, approval, and notification workflows.</li>
 <li>Deliver messages, attachments, Status posts, and configuration-dependent calls.</li>
 <li>Enforce roles, permissions, shop boundaries, dealer relationships, and portal scope.</li>
 <li>Review support and deletion requests after the required identity checks.</li>
 <li>Detect abuse, investigate errors, keep audit records, and protect the service.</li>
 <li>Create or restore a user-initiated backup when that feature is configured and requested.</li>
 </ul>

 <h2>3. Service providers and data movement</h2>
 <p>
 Information may be processed by the infrastructure and service providers needed for hosting, databases, file storage, OTP delivery, email delivery, user-initiated cloud backup, and configuration-dependent calling. Provider availability and production configuration may change. A final operator-specific notice will identify required legal disclosures before public commercial release.
 </p>

 <h2>4. Security and access boundaries</h2>
 <p>
 Avarpus uses authenticated sessions, server-side role checks, and access checks scoped by shop, dealer relationship, and chat-room membership. These controls reduce risk but do not provide an absolute security guarantee. App lock uses supported biometric or device credentials; it does not by itself encrypt stored service data.
 </p>

 <h2>5. Backup and Restore</h2>
 <p>
 Avarpus offers a manual, opt-in Google Drive chat backup when configured and available. The backup is protected before upload with a recovery password you create. It covers chat rooms and messages available to the account, with attachment, video, size, and format limits; it is not a complete backup of application or business data. Current recovery validates and reads the encrypted archive; it does not import chats back into live rooms.
 </p>

 <h2>6. Data Retention and Account Deletion</h2>
 <p>
 Exact retention periods are under operational and legal review. Information may remain while an account or service relationship is active and longer where needed for security, dispute handling, backup integrity, shop-controlled business records, or applicable obligations. Specific periods will be published only after that review.
 </p>
 <p>
 You may submit an account deletion request through the <Link href="/delete-account" className="text-primary hover:text-primary/80 hover:underline">Account Deletion</Link> form. The form records a request; identity verification is required before action is taken. Deletion is not immediate, is not available as a direct in-app action, and has no public request-status lookup. A request does not promise removal of every record.
 </p>
 </div>
 );
}

function PrivacyHi() {
 return (
 <div className="prose prose-blue max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-a:text-primary hover:prose-a:text-primary/80">
 <p className="lead text-muted-foreground font-medium tracking-wide">
 उत्पाद सूचना अद्यतन: 9 सितंबर, 2026
 </p>

 <p>
 Avarpus में आपका स्वागत है। यह प्री-रिलीज़ गोपनीयता सूचना Avarpus एप्लिकेशन और संबंधित सेवाओं के लिए वर्तमान तकनीकी डेटा हैंडलिंग की रूपरेखा तैयार करती है। ऑपरेटर-विशिष्ट कानूनी विवरण और प्रभावी तिथि सार्वजनिक वाणिज्यिक रिलीज़ से पहले प्रकाशित की जाएगी।
 </p>

 <h2>1. सेवा द्वारा नियंत्रित की जाने वाली जानकारी</h2>
 <p>सेवा खाता पहुंच, संचार और मरम्मत-व्यवसाय संचालन के लिए आवश्यक जानकारी को संभालती है।</p>

 <h3>A. खाता, प्रोफ़ाइल और सत्र की जानकारी</h3>
 <ul>
 <li><strong>फ़ोन नंबर:</strong> खाता बनाने और OTP के माध्यम से नियंत्रण सत्यापित करने के लिए उपयोग किया जाता है।</li>
 <li><strong>प्रोफ़ाइल जानकारी:</strong> आपके द्वारा प्रदान किया गया नाम, व्यवसाय विवरण और प्रोफ़ाइल फ़ोटो।</li>
 <li><strong>पहुंच जानकारी:</strong> सत्र, दुकान सदस्यता, भूमिकाएँ, अनुमतियाँ और समर्थित विश्वसनीय-डिवाइस पुनर्प्राप्ति रिकॉर्ड।</li>
 </ul>

 <h3>B. दुकान और परिचालन जानकारी</h3>
 <ul>
 <li><strong>दुकान और लोगों के रिकॉर्ड:</strong> दुकान की सेटिंग्स, कर्मचारी, ग्राहक, B2B डीलर, आपूर्तिकर्ता और संबंधित संपर्क विवरण।</li>
 <li><strong>मरम्मत रिकॉर्ड:</strong> इन्टेक विवरण, उपकरण, निदान, कार्य, पुर्जे, फ़ोटो, परीक्षण, अनुमान, अनुमोदन, डिलीवरी विवरण, हस्ताक्षर, वारंटी, रिटर्न और रिफंड।</li>
 <li><strong>व्यावसायिक रिकॉर्ड:</strong> इन्वेंट्री, खरीदारी, वित्त प्रविष्टियां, खाता प्रविष्टियां, रिकॉर्ड किए गए भुगतान, अग्रिम, बकाया, रिपोर्ट और सूचनाएं।</li>
 </ul>

 <h3>C. संचार और सामग्री</h3>
 <p>
 सेवा संदेशों, अनुलग्नकों, पठन स्थिति, कॉलर-विशिष्ट चैट प्राथमिकताओं, ब्लॉक, रिपोर्ट, स्थिति पोस्ट और दर्शकों, और कॉन्फ़िगर किए गए कॉल मेटाडेटा को संभालती है। डिलीवरी, वार्तालाप इतिहास और मल्टी-डिवाइस एक्सेस का समर्थन करने के लिए संदेशों को सर्वर पर संसाधित और संग्रहीत किया जाता है। Avarpus संदेश एंड-टू-एंड एन्क्रिप्टेड (E2EE) नहीं हैं। ऐप एक्सेस प्रमाणित रूम सदस्यों तक सीमित है; प्लेटफ़ॉर्म इन्फ्रास्ट्रक्चर, ऑपरेटर और प्रोसेसर सेवा को संचालित और सुरक्षित करने के लिए संग्रहीत सामग्री को तकनीकी रूप से संसाधित कर सकते हैं।
 </p>

 <h3>D. संपर्क और अनुमतियाँ</h3>
 <p>
 मोबाइल ऐप द्वारा अनुमति देने के बाद सबमिट की गई संपर्क जानकारी का उपयोग संपर्क मिलान के लिए किया जा सकता है। सर्वर सबमिट किए गए नंबरों का उपयोग योग्य मिलान खोजने के लिए करता है; ब्लॉक किए गए जोड़ों का मिलान नहीं किया जाता। हमने यह स्थापित नहीं किया है कि मिलान के लिए नाम या चित्र भेजे जाते हैं।
 </p>

 <h3>E. तकनीकी, ऑडिट और अनुरोध जानकारी</h3>
 <p>
 सेवा डिवाइस और नेटवर्क पहचानकर्ताओं, आईपी पते, ऐप और त्रुटि लॉग, ऑडिट घटनाओं, दुरुपयोग-रोकथाम रिकॉर्ड और सार्वजनिक समर्थन या हटाने के अनुरोधों के साथ प्रस्तुत मेटाडेटा को संभालती है। विश्वसनीय-डिवाइस पुनर्प्राप्ति हैशेड Android सुरक्षित पहचानकर्ताओं का उपयोग करती है।
 </p>

 <h2>2. सूचना का उपयोग कैसे किया जाता है</h2>
 <p>जानकारी का उपयोग निम्नलिखित के लिए किया जाता है:</p>
 <ul>
 <li>खातों को प्रमाणित करना, सत्र बनाए रखना और खाता पुनर्प्राप्ति नियंत्रण का समर्थन करना।</li>
 <li>मरम्मत, ग्राहक, डीलर, इन्वेंट्री, खरीद, वित्त, खाता, रिटर्न, रिफंड, अनुमोदन और अधिसूचना कार्यप्रवाह चलाना।</li>
 <li>संदेश, अनुलग्नक, स्थिति पोस्ट और कॉन्फ़िगरेशन-निर्भर कॉल वितरित करना।</li>
 <li>भूमिकाओं, अनुमतियों, दुकान सीमाओं, डीलर संबंधों और पोर्टल दायरे को लागू करना।</li>
 <li>आवश्यक पहचान जांच के बाद समर्थन और हटाने के अनुरोधों की समीक्षा करना।</li>
 <li>दुरुपयोग का पता लगाना, त्रुटियों की जांच करना, ऑडिट रिकॉर्ड रखना और सेवा की सुरक्षा करना।</li>
 <li>उस सुविधा के कॉन्फ़िगर और अनुरोध किए जाने पर उपयोगकर्ता द्वारा प्रारंभ किया गया बैकअप बनाना या पुनर्स्थापित करना।</li>
 </ul>

 <h2>3. सेवा प्रदाता और डेटा संचलन</h2>
 <p>
 होस्टिंग, डेटाबेस, फ़ाइल संग्रहण, OTP डिलीवरी, ईमेल डिलीवरी, उपयोगकर्ता द्वारा प्रारंभ किए गए क्लाउड बैकअप और कॉन्फ़िगरेशन-निर्भर कॉलिंग के लिए आवश्यक बुनियादी ढांचे और सेवा प्रदाताओं द्वारा जानकारी को संसाधित किया जा सकता है। प्रदाता उपलब्धता और उत्पादन कॉन्फ़िगरेशन बदल सकता है। एक अंतिम ऑपरेटर-विशिष्ट सूचना सार्वजनिक वाणिज्यिक रिलीज़ से पहले आवश्यक कानूनी प्रकटीकरण की पहचान करेगी।
 </p>

 <h2>4. सुरक्षा और पहुँच सीमाएँ</h2>
 <p>
 Avarpus प्रमाणित सत्र, सर्वर-साइड भूमिका जाँच और दुकान, डीलर संबंध तथा चैट-रूम सदस्यता के दायरे में एक्सेस जाँच का उपयोग करता है। ये नियंत्रण जोखिम को कम करते हैं लेकिन पूर्ण सुरक्षा गारंटी नहीं देते। ऐप लॉक समर्थित बायोमेट्रिक या डिवाइस क्रेडेंशियल्स का उपयोग करता है; यह अपने आप संग्रहीत सेवा डेटा को एन्क्रिप्ट नहीं करता।
 </p>

 <h2>5. बैकअप और पुनर्स्थापना</h2>
 <p>
 Google ड्राइव कॉन्फ़िगर और उपलब्ध होने पर Avarpus मैन्युअल, ऑप्ट-इन चैट बैकअप देता है। अपलोड से पहले बैकअप आपके बनाए हुए रिकवरी पासवर्ड से सुरक्षित किया जाता है। इसमें खाते के लिए उपलब्ध चैट रूम और संदेश शामिल होते हैं तथा अनुलग्नक, वीडियो, आकार और प्रारूप सीमाएँ लागू होती हैं; यह एप्लिकेशन या व्यावसायिक डेटा का पूर्ण बैकअप नहीं है। वर्तमान रिकवरी एन्क्रिप्टेड आर्काइव को सत्यापित और पढ़ती है; चैट को लाइव रूम में वापस आयात नहीं करती।
 </p>

 <h2>6. डेटा प्रतिधारण और खाता हटाना</h2>
 <p>
 सटीक प्रतिधारण अवधि परिचालन और कानूनी समीक्षा के अधीन है। जब कोई खाता या सेवा संबंध सक्रिय हो तो जानकारी बनी रह सकती है और सुरक्षा, विवाद समाधान, बैकअप अखंडता, दुकान-नियंत्रित व्यावसायिक रिकॉर्ड, या लागू दायित्वों के लिए आवश्यक होने पर अधिक समय तक बनी रह सकती है। विशिष्ट अवधियाँ उस समीक्षा के बाद ही प्रकाशित की जाएंगी।
 </p>
 <p>
 आप <Link href="/delete-account" className="text-primary hover:text-primary/80 hover:underline">खाता हटाना</Link> फ़ॉर्म के माध्यम से खाता हटाने का अनुरोध सबमिट कर सकते हैं। फ़ॉर्म एक अनुरोध दर्ज करता है; कार्रवाई किए जाने से पहले पहचान सत्यापन आवश्यक है। हटाना तत्काल नहीं है, सीधे इन-ऐप कार्रवाई के रूप में उपलब्ध नहीं है, और इसमें कोई सार्वजनिक अनुरोध-स्थिति देखने की सुविधा नहीं है। एक अनुरोध हर रिकॉर्ड को हटाने का वादा नहीं करता है।
 </p>
 </div>
 );
}

export default function Privacy() {
 const { language } = useLanguage();

 return (
 <>
 <PageMeta
 title={language === 'hi' ? "प्री-रिलीज़ गोपनीयता सूचना - Avarpus" : "Pre-release Privacy Notice - Avarpus"}
 description={language === 'hi' ? "तकनीकी डेटा हैंडलिंग का विवरण देने वाली Avarpus प्री-रिलीज़ गोपनीयता सूचना।" : "Avarpus Pre-release Privacy Notice detailing technical data handling."}
 path="/privacy"
 />

 <div className="pt-32 pb-24 min-h-[100dvh] bg-background transition-colors duration-300">
 <div className="container mx-auto px-4 sm:px-6">
 <div className="max-w-3xl mx-auto bg-card card-shadow p-8 md:p-14 rounded-[16px] border border-border">
 <h1 className="text-4xl font-extrabold mb-8 text-foreground tracking-tight">
 {language === 'hi' ? "प्री-रिलीज़ गोपनीयता सूचना" : "Pre-release Privacy Notice"}
 </h1>
 {language === 'hi' ? <PrivacyHi /> : <PrivacyEn />}
 </div>
 </div>
 </div>
 </>
 );
}