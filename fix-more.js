const fs = require('fs');

const files = [
  'artifacts/mobile/app/(auth)/index.tsx',
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Any remaining stray colors
  content = content.replace(/#0D1C35/gi, 'rgba(17, 27, 45, 0.68)');
  content = content.replace(/#1E3A5F/gi, 'rgba(255,255,255,0.10)');
  content = content.replace(/#050912/gi, '#0B0F1A');
  
  fs.writeFileSync(file, content, 'utf8');
});
