export const HOME_LOCALE_KEY='lexicue-home-locale-v1';
const supported=['en','zh','ja','de'];
export function browserLocale(languages=[]){
 for(const language of languages){const base=String(language).toLowerCase().split(/[-_]/)[0];if(supported.includes(base))return base;}
 return 'en';
}
/** Localized URLs remain deliberate entry points; the default homepage negotiates language. */
export function initialHomeLocale(route,languages,storage,historyState){
 if(route.chapter||route.explicitLocale)return supported.includes(route.locale)?route.locale:'en';
 if(supported.includes(historyState?.lexicueLocale))return historyState.lexicueLocale;
 try{const selected=storage?.getItem(HOME_LOCALE_KEY);if(supported.includes(selected))return selected;}catch{}
 return browserLocale(languages);
}
export function rememberHomeLocale(locale,storage){if(!supported.includes(locale))return;try{storage?.setItem(HOME_LOCALE_KEY,locale);}catch{}}
