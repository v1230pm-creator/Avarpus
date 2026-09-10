import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(siteRoot, 'src');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return files.flat();
}

const copyFiles = (await listFiles(srcRoot))
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .filter((file) => /[/\\](?:pages|locales|components)[/\\]/.test(file));

const sources = new Map(await Promise.all(copyFiles.map(async (file) => [
  path.relative(siteRoot, file),
  await readFile(file, 'utf8'),
])));

const failures = [];

function fail(message) {
  failures.push(message);
}

function requireAll(file, checks) {
  const source = sources.get(file);
  if (!source) {
    fail(`${file}: required public-copy source is missing`);
    return;
  }
  for (const { label, pattern } of checks) {
    if (!pattern.test(source)) {
      fail(`${file}: missing required limitation wording for ${label}`);
    }
  }
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

const prohibitedClaims = [
  {
    label: 'a positive end-to-end-encryption claim in English',
    patterns: [
      /\b(?:end[- ]to[- ]end encrypted|e2ee)(?:-protected)?\s+(?:messages?|messaging|chats?|communication)\b/gi,
      /\b(?:messages?|messaging|chats?|communication)\s+(?:is|are|uses?)\s+(?:end[- ]to[- ]end encryption|end[- ]to[- ]end encrypted|e2ee)\b/gi,
      /\b(?:offers?|provides?|uses?)\s+(?:end[- ]to[- ]end encryption|e2ee)\b/gi,
    ],
  },
  {
    label: 'a positive end-to-end-encryption claim in Hindi',
    patterns: [
      /(?:एंड[- ]टू[- ]एंड एन्क्रिप्टेड|E2EE)(?:\s+से सुरक्षित)?\s+(?:संदेश|मैसेजिंग|चैट|संचार)/giu,
      /(?:संदेश|मैसेजिंग|चैट|संचार)\s+(?:एंड[- ]टू[- ]एंड एन्क्रिप्टेड|E2EE)\s+(?:है|हैं)/giu,
    ],
  },
  {
    label: 'an automatic backup claim',
    patterns: [
      /\b(?:automatic(?:ally)?|continuous(?:ly)?)\s+(?:creates?|backs? up|backup|backups)\b/gi,
      /\b(?:automatic|continuous)\s+(?:cloud|drive|data|chat|app(?:lication)?)?\s*backups?\b/gi,
      /(?:स्वचालित|अपने आप|लगातार)\s+(?:क्लाउड|ड्राइव|डेटा|चैट|ऐप)?\s*बैकअप/giu,
    ],
  },
  {
    label: 'a full or complete backup claim',
    patterns: [
      /\b(?:full|complete|entire)\s+(?:app(?:lication)?|business(?: data)?|data)?[- ]*backups?\b/gi,
      /(?:पूर्ण|पूरा|संपूर्ण)\s+(?:ऐप|एप्लिकेशन|व्यावसायिक|डेटा)?[- ]*बैकअप/giu,
    ],
  },
  {
    label: 'a payment-processing or money-transfer claim',
    patterns: [
      /\bAvarpus\s+(?:now\s+)?(?:process(?:es|ing)? payments?|hold(?:s|ing)? funds?|transfer(?:s|ring)? (?:money|funds?))\b/gi,
      /\b(?:process payments?|payment processing|hold funds?|transfer (?:money|funds?))\s+(?:in|with|through|by)\s+Avarpus\b/gi,
      /Avarpus\s+(?:अब\s+)?(?:भुगतान (?:प्रोसेस|संसाधित) करता|धन (?:रखता|होल्ड करता|स्थानांतरित करता|ट्रांसफर करता))/giu,
    ],
  },
  {
    label: 'an absolute security guarantee',
    patterns: [
      /\b(?:100%\s+secure|completely secure|fully secure|absolute security guarantee|guaranteed security|security (?:is )?guaranteed|cannot be hacked|unhackable)\b/gi,
      /(?:100%\s+सुरक्षित|पूरी तरह सुरक्षित|पूर्ण सुरक्षा गारंटी|हैक नहीं किया जा सकता)/giu,
    ],
  },
  {
    label: 'guaranteed notification or response timing',
    patterns: [
      /\b(?:instant|guaranteed|always|within \d+\s*(?:minutes?|hours?|days?))\s+(?:push\s+)?(?:notifications?|alerts?|responses?|replies|delivery)\b/gi,
      /\b(?:notifications?|alerts?|responses?|replies|delivery)\s+(?:is|are|will be)\s+(?:instant|guaranteed|always on time|delivered within \d+\s*(?:minutes?|hours?|days?))\b/gi,
      /(?:तुरंत|गारंटीकृत|हमेशा समय पर|\d+\s*(?:मिनट|घंटे|दिन) के भीतर)\s+(?:पुश\s+)?(?:सूचनाएं|अलर्ट|जवाब|प्रतिक्रिया|डिलीवरी)/giu,
    ],
  },
  {
    label: 'an unverified app-store channel',
    patterns: [/\b(?:Google Play(?: Store)?|Apple App Store|TestFlight|Microsoft Store)\b/gi],
    allowNegation: false,
  },
  {
    label: 'a development or Expo distribution channel',
    patterns: [/\b(?:https?:\/\/[^\s"'`]*(?:replit\.dev|repl\.co)|exp(?:s)?:\/\/)\S*/gi],
    allowNegation: false,
  },
];

function isDirectlyNegated(source, index, length) {
  const before = source.slice(Math.max(0, index - 45), index);
  const after = source.slice(index + length, index + length + 30);
  const englishPrefix = /\b(?:not|never|no|does not|do not|cannot|isn't|aren't)\s+(?:(?:a|an|any|make|provide|offer)\s+){0,2}$/i;
  const hindiPrefix = /(?:नहीं|कोई नहीं)\s*$/u;
  const hindiSuffix = /^\s+(?:नहीं|नहीं है|नहीं हैं|नहीं करता|नहीं करती)/u;
  return englishPrefix.test(before) || hindiPrefix.test(before) || hindiSuffix.test(after);
}

for (const [file, source] of sources) {
  for (const rule of prohibitedClaims) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        if (rule.allowNegation === false || !isDirectlyNegated(source, match.index, match[0].length)) {
          fail(`${file}:${lineNumber(source, match.index)}: prohibited ${rule.label}: "${match[0]}"`);
        }
      }
    }
  }
}

const appSource = await readFile(path.join(srcRoot, 'App.tsx'), 'utf8');
if (/\b(?:new Date|Date\.now)\s*\(/.test(sources.get('src/pages/privacy.tsx') ?? '') ||
    /\b(?:new Date|Date\.now)\s*\(/.test(sources.get('src/pages/terms.tsx') ?? '')) {
  fail('Privacy and Terms legal dates must be fixed reviewed copy, not generated dynamically');
}

requireAll('src/pages/privacy.tsx', [
  { label: 'English messages not being E2EE', pattern: /not End-to-End Encrypted \(E2EE\)/ },
  { label: 'Hindi messages not being E2EE', pattern: /एंड-टू-एंड एन्क्रिप्टेड \(E2EE\) नहीं/ },
  { label: 'English manual opt-in backup limits', pattern: /manual, opt-in Google Drive chat backup/ },
  { label: 'Hindi manual opt-in backup limits', pattern: /मैन्युअल, ऑप्ट-इन चैट बैकअप/ },
  { label: 'English retention periods still under review', pattern: /Exact retention periods are under operational and legal review/ },
  { label: 'Hindi retention periods still under review', pattern: /सटीक प्रतिधारण अवधि परिचालन और कानूनी समीक्षा के अधीन/ },
  { label: 'English deletion requiring identity verification', pattern: /identity verification is required before action is taken/ },
  { label: 'Hindi deletion requiring identity verification', pattern: /कार्रवाई किए जाने से पहले पहचान सत्यापन आवश्यक/ },
  { label: 'English permission-based contact matching', pattern: /after you grant permission/ },
  { label: 'Hindi permission-based contact matching', pattern: /अनुमति देने के बाद/ },
]);

requireAll('src/pages/security.tsx', [
  { label: 'English no absolute security guarantee', pattern: /do not make absolute security guarantees/ },
  { label: 'Hindi no absolute security guarantee', pattern: /पूर्ण सुरक्षा गारंटी नहीं/ },
  { label: 'English messages not being E2EE', pattern: /not End-to-End Encrypted \(E2EE\)/ },
  { label: 'Hindi messages not being E2EE', pattern: /एंड-टू-एंड एन्क्रिप्टेड \(E2EE\) नहीं/ },
  { label: 'English backup scope and restore limits', pattern: /not a full application-data backup[\s\S]{0,100}does not import chats/ },
  { label: 'Hindi backup scope and restore limits', pattern: /पूर्ण एप्लिकेशन-डेटा बैकअप नहीं[\s\S]{0,120}आयात नहीं करती/ },
  { label: 'English permission-based contact matching', pattern: /after you grant permission/ },
  { label: 'Hindi permission-based contact matching', pattern: /अनुमति देने के बाद/ },
]);

requireAll('src/pages/download.tsx', [
  { label: 'English direct Android APK availability', pattern: /latest published Avarpus Android APK[\s\S]{0,80}direct download/ },
  { label: 'Hindi direct Android APK availability', pattern: /नवीनतम प्रकाशित Android APK[\s\S]{0,100}सीधे डाउनलोड/ },
  { label: 'English unannounced iOS availability', pattern: /iOS public channel has not been announced/ },
  { label: 'Hindi unannounced iOS availability', pattern: /iOS सार्वजनिक चैनल की घोषणा अभी नहीं हुई/ },
  { label: 'English native feature dependencies', pattern: /depend on supported native builds, device permissions, release configuration, and enabled services/ },
  { label: 'Hindi native feature dependencies', pattern: /समर्थित नेटिव बिल्ड, डिवाइस अनुमतियों, रिलीज़ कॉन्फ़िगरेशन और सक्षम सेवाओं पर निर्भर/ },
]);

requireAll('src/locales/features.ts', [
  { label: 'English server-stored chat not being E2EE', pattern: /Server-stored history for multi-device access \(not E2EE\)/ },
  { label: 'Hindi server-stored chat not being E2EE', pattern: /सर्वर-स्टोर्ड इतिहास \(E2EE नहीं\)/ },
  { label: 'English configured native call availability', pattern: /supported native builds where call services are configured/ },
  { label: 'Hindi configured native call availability', pattern: /समर्थित नेटिव बिल्ड में उपलब्ध है जहां कॉल सेवाएं कॉन्फ़िगर/ },
  { label: 'English finance being records rather than fund handling', pattern: /does not hold or transfer funds/ },
  { label: 'Hindi finance being records rather than fund handling', pattern: /धन रखता या स्थानांतरित नहीं करता/ },
  { label: 'English manual backup and restore limits', pattern: /not a full app backup, and recovery does not import chats/ },
  { label: 'Hindi manual backup and restore limits', pattern: /पूरा ऐप बैकअप नहीं है और रिकवरी चैट को लाइव रूम में आयात नहीं करती/ },
  { label: 'English notification timing dependency', pattern: /push delivery and timing depend on provider and production configuration/ },
  { label: 'Hindi notification timing dependency', pattern: /पुश डिलीवरी और समय प्रदाता तथा प्रोडक्शन कॉन्फ़िगरेशन पर निर्भर/ },
]);

requireAll('src/locales/solutions.ts', [
  { label: 'English communication not being E2EE', pattern: /They are NOT end-to-end encrypted/ },
  { label: 'Hindi communication not being E2EE', pattern: /वे एंड-टू-एंड एन्क्रिप्टेड नहीं हैं/ },
  { label: 'English permission-based contact matching', pattern: /after you grant permission/ },
  { label: 'Hindi permission-based contact matching', pattern: /आपकी अनुमति के बाद/ },
  { label: 'English configured native call availability', pattern: /supported native builds where call services are configured/ },
  { label: 'Hindi configured native call availability', pattern: /समर्थित नेटिव बिल्ड में उपलब्ध हैं जहाँ कॉल सेवाएँ कॉन्फ़िगर/ },
  { label: 'English finance records not processing funds', pattern: /does not process, hold, or transfer funds/ },
  { label: 'Hindi finance records not processing funds', pattern: /धन को प्रोसेस, होल्ड या ट्रांसफर नहीं करता/ },
  { label: 'English manual backup and restore limits', pattern: /Manually create an opt-in chat backup[\s\S]{0,260}does not import chats into live rooms/ },
  { label: 'Hindi manual backup and restore limits', pattern: /मैन्युअल, ऑप्ट-इन चैट बैकअप[\s\S]{0,300}चैट को लाइव रूम में आयात नहीं करती/ },
]);

const declaredRoutes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
const duplicateRoutes = declaredRoutes.filter((route, index) => declaredRoutes.indexOf(route) !== index);
if (duplicateRoutes.length) {
  fail(`src/App.tsx: duplicate public routes: ${[...new Set(duplicateRoutes)].join(', ')}`);
}

const sitemap = await readFile(path.join(siteRoot, 'public/sitemap.xml'), 'utf8');
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/avarpass\.com(\/[^<]*)<\/loc>/g)]
  .map((match) => match[1].replace(/\/$/, '') || '/');

for (const route of declaredRoutes) {
  if (!sitemapPaths.includes(route)) {
    fail(`public/sitemap.xml: missing public route ${route}`);
  }
}
for (const sitemapPath of sitemapPaths) {
  if (!declaredRoutes.includes(sitemapPath)) {
    fail(`public/sitemap.xml: ${sitemapPath} is not a declared public route`);
  }
}

if (failures.length) {
  console.error(`Public claims validation failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public claims validation passed (${sources.size} copy files, ${declaredRoutes.length} public routes).`);