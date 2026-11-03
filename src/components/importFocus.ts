let opener: HTMLElement | null = null;
/** Safari does not reliably focus buttons on pointer activation. */
export function rememberImportFocus(element: HTMLElement) { element.focus({preventScroll:true}); opener = element; }
export function takeImportFocus() { const result = opener; opener = null; return result?.isConnected ? result : null; }
