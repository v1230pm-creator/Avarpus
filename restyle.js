const fs = require('fs');

const files = [
  'artifacts/mobile/app/(auth)/index.tsx',
  'artifacts/mobile/app/(auth)/register.tsx',
  'artifacts/mobile/app/(auth)/forgot.tsx',
  'artifacts/mobile/app/(auth)/otp.tsx',
  'artifacts/mobile/app/(auth)/biometric.tsx'
];

files.forEach(file => {
  if (!fs.existsSync(file)) {
    console.error(`Missing file: ${file}`);
    return;
  }
  let content = fs.readFileSync(file, 'utf8');

  // Background gradients
  content = content.replace(/colors=\{\['#050912', '#091525', '#030710'\]\}/g, "colors={['#0B0F1A', '#0E1422']}");
  content = content.replace(/colors=\{\['#060A14', '#0D1528', '#060A14'\]\}/g, "colors={['#0B0F1A', '#0E1422']}");
  content = content.replace(/locations=\{\[0, 0\.5, 1\]\}/g, "locations={[0, 1]}");
  
  // Specific literal hex updates for backgrounds
  content = content.replace(/#0B1526AA/gi, 'rgba(20, 30, 48, 0.58)');
  content = content.replace(/#0D1B2E/gi, 'rgba(20, 30, 48, 0.58)');
  content = content.replace(/#0A1628/gi, 'rgba(17, 27, 45, 0.68)');
  content = content.replace(/#0D1E3A/gi, 'rgba(20, 30, 48, 0.58)');
  content = content.replace(/#080F1D/gi, 'rgba(17, 27, 45, 0.68)');
  content = content.replace(/#0F172A/gi, 'rgba(17, 27, 45, 0.68)');
  content = content.replace(/#1E3A5F66/gi, 'rgba(255,255,255,0.10)');
  content = content.replace(/#1E3A5F44/gi, 'rgba(255,255,255,0.07)');
  content = content.replace(/#1E3A5F55/gi, 'rgba(255,255,255,0.07)');
  content = content.replace(/#1E293B/gi, 'rgba(255,255,255,0.10)');
  content = content.replace(/#334155/gi, 'rgba(255,255,255,0.10)');
  
  // Replace string literal 'rgba(255,255,255,0.10)' if it causes any issues, wait it's just strings.

  // Shadows
  content = content.replace(/shadowColor: '#000', shadowOpacity: 0\.4, shadowRadius: 30/gi, "shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 24");
  content = content.replace(/shadowColor: '#000000', shadowOpacity: 0\.4, shadowRadius: 30/gi, "shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 24");
  content = content.replace(/elevation: 12/g, "elevation: 4");

  // Blues
  content = content.replace(/#1D4ED8/gi, '#2F80ED');
  content = content.replace(/#2563EB/gi, '#3A8FF7');
  content = content.replace(/#3B82F6/gi, '#3A8FF7');
  content = content.replace(/#60A5FA/gi, '#4DA3FF');
  content = content.replace(/#93C5FD/gi, '#4DA3FF');
  
  // Text colors
  content = content.replace(/#F1F5F9/gi, '#F5F7FA');
  content = content.replace(/#64748B/gi, '#A8B3C7');
  content = content.replace(/#94A3B8/gi, '#A8B3C7');
  content = content.replace(/#475569/gi, '#7F8BA3');
  
  // Golds to Blues
  content = content.replace(/#D4AF37/gi, '#3A8FF7');
  
  // Adjust Glow opacities
  content = content.replace(/opacity: 0\.12 \+ \(i % 4\) \* 0\.06/g, 'opacity: 0.08 + (i % 4) * 0.04');
  content = content.replace(/opacity: 0\.1 \}/g, 'opacity: 0.05 }');
  content = content.replace(/opacity: 0\.08 \}/g, 'opacity: 0.04 }');
  content = content.replace(/opacity: 0\.06 \}/g, 'opacity: 0.03 }');
  content = content.replace(/opacity: 0\.04 \}/g, 'opacity: 0.02 }');
  content = content.replace(/opacity: 0\.07 \}/g, 'opacity: 0.04 }');

  // Replace emojis
  content = content.replace(/<Text style=\{\[styles\.countryFlag, \{ fontFamily: 'Inter_400Regular' \}\]\}>🇮🇳<\/Text>/g, '');
  content = content.replace(/<Text style=\{\[gs\.countryFlag, \{ fontFamily: 'Inter_400Regular' \}\]\}>🇮🇳<\/Text>/g, '');

  fs.writeFileSync(file, content, 'utf8');
});
console.log('Done!');
