import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {copy,locales,features,siteUrl,repoUrl} from '../src/catalogue.mjs';
const root=resolve(import.meta.dirname,'../..');
const files={en:'README.md',zh:'README.zh-CN.md',ja:'README.ja.md',de:'README.de.md'};
for(const locale of locales){const c=copy[locale],r=c.readme;
 const md=`<p align="center"><img src="docs/lexicue-icon.png" width="88" alt="LexiCue"></p>
<h1 align="center">LexiCue</h1>
<p align="center"><strong>${c.tag}</strong></p>
<p align="center">${locales.map(l=>`<a href="${files[l]}">${{en:'English',zh:'简体中文',ja:'日本語',de:'Deutsch'}[l]}</a>`).join(' · ')}</p>

<p align="center">
  <a href="${repoUrl}/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/skylar-deepmind/LexiCue?style=flat-square&color=2563eb"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-2563eb?style=flat-square"></a>
  <a href="${repoUrl}/actions/workflows/ci.yml"><img alt="CI status" src="${repoUrl}/actions/workflows/ci.yml/badge.svg"></a>
  <a href="${repoUrl}/releases/latest"><img alt="macOS, Windows, Android" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Android-526177?style=flat-square"></a>
  <a href="${siteUrl}${locale==='en'?'':locale+'/'}#feature-languages"><img alt="English, Japanese, German, Chinese" src="https://img.shields.io/badge/languages-EN%20%7C%20JA%20%7C%20DE%20%7C%20ZH-526177?style=flat-square"></a>
</p>

<p align="center"><a href="${repoUrl}/releases/latest"><strong>${c.download}</strong></a> · <a href="${siteUrl}${locale==='en'?'':locale+'/'}">${c.features}</a> · <a href="DISTRIBUTION.md">${c.installGuide}</a></p>

[![${c.titles[0]}](docs/media/demo/hero.gif)](${siteUrl}${locale==='en'?'':locale+'/'}#feature-import)

## ${r.heading}

${c.intro}

## ${r.quick}

${c.steps.map((s,i)=>`${i+1}. **${s}** — ${c.stepDescriptions[i]}`).join('\n')}

## ${r.demos}

${['lookup','phrases','review'].map((id,i)=>`### ${r.demoLinks[i]}\n\n[![${r.demoLinks[i]}](docs/media/demo/${id}.gif)](${siteUrl}${locale==='en'?'':locale+'/'}#feature-${id})\n\n${c.descriptions[features.findIndex(f=>f.id===id)]}`).join('\n\n')}

> ${r.limitations}

## ${r.all}

${features.map(f=>`- **[${c.titles[f.index]}](${siteUrl}${locale==='en'?'':locale+'/'}#feature-${f.id})** — ${c.descriptions[f.index]}`).join('\n')}

## ${r.install}

${c.installBody}

[**${c.download} — macOS / Windows / Android**](${repoUrl}/releases/latest)

${c.installNote} [${c.installGuide}](DISTRIBUTION.md).

Gemma: [E2B / E4B](docs/embedded-gemma.md).

## ${r.privacy}

${c.privacyBody}

## ${r.support}

[${c.support} — 爱发电 / Aifadian](https://www.ifdian.net/a/skylar-lexicue) · [GitHub Star](${repoUrl})

## ${r.development}

Node.js 22.12+ · Rust · CMake 3.22+ · C++17. [Gemma](docs/embedded-gemma.md).

\`\`\`sh
npm install
npm run tauri dev
npm run build
npm test
cd src-tauri && cargo test
\`\`\`

[Marketing / README / Website / Video](marketing/README.md)

## ${r.license}

[MIT](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES.md) · [Dictionary packs](DICTIONARY_PACK.md)
`;
 await writeFile(resolve(root,files[locale]),md);
}console.log('Updated four localized READMEs.');
