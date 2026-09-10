import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const mutations = [
  {
    name: 'adjective-first English E2EE claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "End-to-end encrypted messaging for every business";\n`,
    expected: 'positive end-to-end-encryption claim in English',
  },
  {
    name: 'positive Hindi E2EE claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "एंड-टू-एंड एन्क्रिप्टेड संदेश";\n`,
    expected: 'positive end-to-end-encryption claim in Hindi',
  },
  {
    name: 'automatic backup claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Automatic cloud backups";\n`,
    expected: 'automatic backup claim',
  },
  {
    name: 'full backup claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Complete business data backup";\n`,
    expected: 'full or complete backup claim',
  },
  {
    name: 'payment processing claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Avarpus processes payments";\n`,
    expected: 'payment-processing or money-transfer claim',
  },
  {
    name: 'absolute security claim',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Completely secure communication";\n`,
    expected: 'absolute security guarantee',
  },
  {
    name: 'guaranteed notification timing',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Instant notifications";\n`,
    expected: 'guaranteed notification or response timing',
  },
  {
    name: 'unverified store channel',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "Available on Google Play Store";\n`,
    expected: 'unverified app-store channel',
  },
  {
    name: 'development distribution URL',
    file: 'src/locales/home.ts',
    mutate: (source) => `${source}\nexport const regression = "https://example.replit.dev/download";\n`,
    expected: 'development or Expo distribution channel',
  },
  {
    name: 'dynamic legal date',
    file: 'src/pages/privacy.tsx',
    mutate: (source) => `${source}\nconst regression = new Date();\n`,
    expected: 'legal dates must be fixed reviewed copy',
  },
  {
    name: 'missing Hindi E2EE limitation',
    file: 'src/pages/privacy.tsx',
    mutate: (source) => source.replace('एंड-टू-एंड एन्क्रिप्टेड (E2EE) नहीं हैं', 'एंड-टू-एंड एन्क्रिप्टेड (E2EE) हैं'),
    expected: 'missing required limitation wording for Hindi messages not being E2EE',
  },
  {
    name: 'missing sitemap route',
    file: 'public/sitemap.xml',
    mutate: (source) => source.replace(/\s*<url>\s*<loc>https:\/\/avarpass\.com\/security<\/loc>[\s\S]*?<\/url>/, ''),
    expected: 'missing public route /security',
  },
];

function runValidator(root) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/validate-public-claims.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'avarpus-public-claims-'));

try {
  for (const directory of ['scripts', 'src', 'public']) {
    await cp(path.join(siteRoot, directory), path.join(tempRoot, directory), { recursive: true });
  }

  const baseline = runValidator(tempRoot);
  if (baseline.status !== 0) {
    throw new Error(`Baseline validation failed:\n${baseline.stdout}${baseline.stderr}`);
  }

  for (const mutation of mutations) {
    const target = path.join(tempRoot, mutation.file);
    const original = await readFile(target, 'utf8');
    const changed = mutation.mutate(original);
    if (changed === original) {
      throw new Error(`${mutation.name}: fixture did not change ${mutation.file}`);
    }
    await writeFile(target, changed);
    const result = runValidator(tempRoot);
    await writeFile(target, original);
    const output = `${result.stdout}${result.stderr}`;
    if (result.status === 0 || !output.includes(mutation.expected)) {
      throw new Error(`${mutation.name}: expected rejection containing "${mutation.expected}"\n${output}`);
    }
  }

  console.log(`Public claims mutation tests passed (${mutations.length} rejected regressions).`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}