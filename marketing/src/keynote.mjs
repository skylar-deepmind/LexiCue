// The build and the interactive site share this markup, including its native anchor navigation.
import {keynoteCopy,tourControls} from './keynote-copy.mjs';
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
  const scenes = [
    {id:'highlights', clip:'desk', copy:c.library, guide:'files', still:image('library', c.alts[0], 'kn-library-img', 937, 800)},
    {id:'lookup', clip:'lookup', copy:c.lookup, guide:'reading', still:image(locale+'-lookup', c.alts[1], 'kn-lookup-img', 780, 400)},
    {id:'memory', clip:'memory', copy:c.memory, guide:'review', still:`<figure><figcaption>${c.saved}</figcaption>${sentence('saved', c.alts[2], 1100, 261, 652, 336)}</figure>
      <figure><figcaption>${c.again}</figcaption>${sentence('recall', c.alts[3], 618, 70, 700, 112)}</figure>`},
  ];
  const controls = tourControls[locale];
  return `<section class="kn-hero" aria-labelledby="kn-title">
    <img class="kn-optic" src="${escape(asset('media/keynote/context.webp'))}" alt="" width="1536" height="1024" fetchpriority="high">
    <div class="kn-wrap kn-hero-inner"><p class="kn-brandline"><span>LexiCue</span> / ${c.category}</p>
      <h1 id="kn-title">${c.headline.map(line => `<span>${line}</span>`).join('')}</h1>
      <p class="kn-intro">${c.intro}</p>
      <div class="kn-actions"><a class="kn-try" href="#experience">${c.try}</a><a class="kn-explore" href="#highlights">${c.explore}<span aria-hidden="true">↓</span></a></div>
    </div>
  </section>
  <div class="kn-tour">
    <nav class="kn-index" aria-label="${c.details}"><div class="kn-wrap"><strong>${c.details}</strong>
      ${scenes.map(scene=>`<a href="#${scene.id}">${scene.copy[0]}</a>`).join('')}
    </div></nav>
    <div class="kn-sequence kn-wrap">
      <div class="kn-pin" hidden>
        <div class="kn-player">
          <div class="kn-screen">
            ${scenes.map(scene=>`<div class="kn-view" data-clip="${scene.clip}">
              <div class="kn-poster kn-poster-${scene.clip}" aria-hidden="true">${scene.still}</div>
              <video muted playsinline preload="none" aria-label="${escape(scene.copy[0])}" data-desktop="${escape(asset('media/keynote/motion/'+locale+'-'+theme+'-desktop-'+scene.clip+'.mp4'))}" data-phone="${escape(asset('media/keynote/motion/'+locale+'-'+theme+'-phone-'+scene.clip+'.mp4'))}"></video>
            </div>`).join('')}
          </div>
          <div class="kn-transport"><span class="kn-transport-label">${c.library[0]}</span>
            <div class="kn-meter" aria-hidden="true"><i></i></div>
            <button class="kn-play" type="button"><span class="kn-play-icon" aria-hidden="true"></span><span class="kn-play-label">${controls.play}</span></button>
          </div>
        </div>
      </div>
      <div class="kn-chapters">${scenes.map(scene=>`<section id="${scene.id}" class="kn-story">
        ${intro(scene.copy,scene.guide)}<div class="kn-print kn-poster-${scene.clip}">${scene.still}</div>
      </section>`).join('')}</div>
    </div>
  </div>`;
}
