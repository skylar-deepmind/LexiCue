# Current product browser demo

`entry.tsx` loads the actual `src/App.tsx`, pages, stores, translations and CSS. `vite.demo.config.mjs` replaces only the native I/O boundary, changes the router to `HashRouter`, inserts a theme message bridge, and makes font/PDF support URLs relative to the built demo. The desktop material stage shares its height distribution with the installed app: cards use the available vertical space and the pager/library remain below them.

```sh
node marketing/scripts/build-demo.mjs
```

The build runs its TypeScript check and engine/storage/speech tests, then writes `docs/_demo/index.html`. Serve the repository and open `/docs/_demo/index.html?locale=zh&theme=ocean`. `locale` accepts `en`, `zh`, `ja`, `de`; `theme` accepts the five product themes. Hash routes preserve the reading page after refresh on static hosting.

The three original English samples have existing Chinese translations. `A quiet morning.txt` has a saved `take off` context; `The next journey.txt` encounters that expression in another sense. The actual app controls read and mutate temporary materials, saved contexts, personal explanations, tags and reading positions. File selection and drag/drop pass only explicitly selected browser `File` objects through the existing document workers. Text paste uses the same preparation code.

The native boundary has no database or network client. The dictionary covers all 85 clickable English token positions (60 distinct word forms) in the built-in samples, plus common sample phrases. Entries use original CC0 bilingual definitions, word classes, pronunciations and examples through the installed app’s real dictionary renderer; inflected forms resolve to their base entries. The dictionary remains labelled as sample data. Unknown words in imported text return `not_found`, rather than a fabricated definition. New translation, remote webpage/YouTube retrieval, installation and device pairing are unavailable. Existing bilingual input still works; untranslated input can continue in English. Speech uses browser `SpeechSynthesis` and its real start/resume/end/error events. Real speech preferences select US/GB language and a normal/slow base rate, multiplied by the reader rate. Browser voice support and user activation determine availability; the native named-voice control and Edge/cache settings are replaced only in this demo build with an automatic browser voice and a short capability explanation.

The original browser `sessionStorage` is used only for `lexicue-current-demo-v1`. Product `localStorage` and `sessionStorage` are replaced inside this iframe with separate virtual stores persisted within that one namespace. Refresh keeps the current tab's sample data; other tabs have independent changes. Corrupt/older snapshots reset to the original samples. Reset removes only this namespace. No real product library, personal storage keys, model, account, native file path or paired device is accessed.

Same-origin iframe protocol:

- Child → parent: `{type: 'lexicue-demo-ready'}` after mounting.
- Parent → child: `{type: 'lexicue-demo-preferences', locale, theme}` updates the live stores and real `ThemeProvider` without reloading business data.
- Parent → child: `{type: 'lexicue-demo-reset'}` clears temporary data and reloads the iframe.

Incoming messages require both the same origin and `event.source === window.parent`. Exported backup JSON is marked `demo: true`; the restore boundary accepts only this demo format.

The demo build maps the app’s local lookup slot to its existing original CC0 sample adapter. It does not impersonate Wiktionary metadata or weaken the installed-app validator. The native dictionary-pack settings view is replaced only in this browser build with an explicit installation boundary.
