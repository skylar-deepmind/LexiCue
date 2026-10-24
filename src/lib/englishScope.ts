// Conservative detection of clearly foreign Latin-script captions. Short names and
// ambiguous snippets remain accepted; this is a guard, not a language guarantee.
const english = new Set('a the this that we i you he she it is are was were have has will would do does not to of with and at on hello thank thanks yes no good please'.split(' '));
const foreign = new Set('ich und ist nicht sind wir das ein eine der die sie für mit auf haben aber auch heute guten morgen bonjour merci une les des nous vous est pas avec dans pour que je suis hola gracias los las una usted nosotros buenos días nicht ciao grazie della degli siamo sono buongiorno você não uma muito obrigado'.split(' '));
export function clearlyNonEnglish(text: string): boolean {
    const tokens = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
    const en = tokens.filter(word => english.has(word)).length;
    const other = tokens.filter(word => foreign.has(word)).length;
    return other >= 2 && other > en;
}
