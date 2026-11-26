// The build and the interactive site share this markup, including its native anchor navigation.
import {keynoteCopy} from './keynote-copy.mjs';
import {escapeHtml as escape} from './manual-render.mjs';

export function renderKeynote(locale, theme, asset, guide) {
  const c = keynoteCopy[locale];
  const imageUrl = name => escape(asset(`media/keynote/${name}-${theme}.webp`));
  const image = (name, alt, className, width, height) => `<img class="${className}" src="${imageUrl(name)}" alt="${escape(alt)}" width="${width}" height="${height}" loading="lazy" decoding="async">`;
  const sentence = (name, alt, width, height, phoneWidth, phoneHeight) => `<picture>
    <source media="(max-width: 760px)" srcset="${imageUrl(name + '-phone')}" width="${phoneWidth}" height="${phoneHeight}">
    ${image(name, alt, 'kn-sentence-img', width, height)}
  </picture>`;
  const intro = (copy, chapter) => `<div class="kn-story-copy"><p class="kn-label">${copy[0]}</p><h2>${copy[1]}</h2><p>${copy[2]}</p><a class="kn-guide" aria-label="${escape(c.guide + ' · ' + copy[0])}" href="${escape(guide(chapter))}">${c.guide}</a></div>`;
  return `<section class="kn-hero" aria-labelledby="kn-title">
    <img class="kn-optic" src="${escape(asset('media/keynote/context.webp'))}" alt="" width="1536" height="1024" fetchpriority="high">
    <div class="kn-wrap kn-hero-inner"><p class="kn-brandline"><span>LexiCue</span> / ${c.category}</p>
      <h1 id="kn-title">${c.headline.map(line => `<span>${line}</span>`).join('')}</h1>
      <p class="kn-intro">${c.intro}</p>
      <div class="kn-actions"><a class="kn-try" href="#experience">${c.try}</a><a class="kn-explore" href="#highlights">${c.explore}<span aria-hidden="true">↓</span></a></div>
    </div>
  </section>
  <nav class="kn-index" aria-label="${c.details}"><div class="kn-wrap"><strong>${c.details}</strong><a href="#highlights">${c.library[0]}</a><a href="#lookup">${c.lookup[0]}</a><a href="#memory">${c.memory[0]}</a></div></nav>
  <section id="highlights" class="kn-story kn-library"><div class="kn-wrap kn-split">${intro(c.library, 'files')}
    <div class="kn-stage kn-library-stage">${image('library', c.alts[0], 'kn-library-img', 937, 800)}</div>
  </div></section>
  <section id="lookup" class="kn-story kn-lookup"><div class="kn-wrap kn-split">${intro(c.lookup, 'reading')}
    <div class="kn-stage kn-lookup-stage"><p class="kn-passage" lang="en" aria-hidden="true">A <mark>quiet</mark> morning is a good time to read.</p>${image(locale + '-lookup', c.alts[1], 'kn-lookup-img', 780, 400)}</div>
  </div></section>
  <section id="memory" class="kn-story kn-memory"><div class="kn-wrap">${intro(c.memory, 'review')}
    <div class="kn-pair"><figure><figcaption>${c.saved}</figcaption>${sentence('saved', c.alts[2], 1100, 261, 652, 336)}</figure>
    <figure><figcaption>${c.again}</figcaption>${sentence('recall', c.alts[3], 618, 70, 700, 112)}</figure></div>
  </div></section>`;
}
