// The build and the interactive site share this markup, including its native anchor navigation.
import {keynoteCopy} from './keynote-copy.mjs';
import {escapeHtml as escape} from './manual-render.mjs';

export function renderKeynote(locale, theme, asset) {
  const c = keynoteCopy[locale];
  const scenes = [
    {id:'highlights', clip:'desk', copy:c.library},
    {id:'lookup', clip:'lookup', copy:c.lookup},
    {id:'listen', clip:'listen', copy:c.listen},
    {id:'save', clip:'save', copy:c.save},
    {id:'memory', clip:'memory', copy:c.memory},
  ];
  const source = (clip, layout) => escape(asset(`media/keynote/motion/${locale}-${theme}-${layout}-${clip}`));
  const still = scene => `<picture><source media="(max-width:760px)" srcset="${source(scene.clip,'phone')}-still.webp"><img loading="lazy" src="${source(scene.clip,'desktop')}-still.webp" alt="${escape(scene.copy[1])}" width="832" height="560"></picture>`;
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
              <img alt="${escape(scene.copy[1])}" data-desktop="${source(scene.clip,'desktop')}" data-phone="${source(scene.clip,'phone')}">
            </div>`).join('')}
            <canvas class="kn-dust" aria-hidden="true"></canvas>
          </div>
          <button class="kn-hear" type="button" hidden aria-label="${c.hear}" aria-pressed="false" data-idle="${c.hear}" data-active="${c.stop}">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10h4l5-4v12l-5-4H3z M16 9c2 2 2 4 0 6 M19 6c4 4 4 8 0 12"/></svg>
          </button>
          <audio preload="none" src="${escape(asset('media/keynote/quiet-morning.wav'))}"></audio>
        </div>
      </div>
      <div class="kn-chapters">${scenes.map(scene=>`<section id="${scene.id}" class="kn-story">
        <h2>${scene.copy[1]}</h2><div class="kn-print">${still(scene)}</div>
      </section>`).join('')}</div>
    </div>
  </div>`;
}
