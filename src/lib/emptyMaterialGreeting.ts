// Retain playback across route/theme changes; a nonempty library rearms it.
let greeted = false;
export const hasGreetedEmptyMaterial = () => greeted;
export function markEmptyMaterialGreeted() { greeted = true; }
export function rearmEmptyMaterialGreeting() { greeted = false; }
