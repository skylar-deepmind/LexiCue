/** Coach controls share focus ownership with the real dialog being explained. */
export function associatedGuide(element:HTMLElement) {
  return element.querySelector('[data-guide-anchor-active]')?document.querySelector<HTMLElement>('[data-app-guide]'):null;
}
