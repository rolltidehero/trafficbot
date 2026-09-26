export const countryLocales: Record<string, readonly string[]> = {
  BR: ['pt-BR'], US: ['en-US'], GB: ['en-GB'], DE: ['de-DE'], FR: ['fr-FR'],
  CA: ['en-CA', 'fr-CA'], AU: ['en-AU'], JP: ['ja-JP'], IN: ['en-IN', 'hi-IN'],
};
export class LocaleProvider {
  static forCountry(country: string): string {
    const locale = countryLocales[country]?.[0];
    if (!locale) throw new Error(`No locale policy configured for country ${country}`);
    return locale;
  }
  static values(locale: string) {
    const canonical = Intl.getCanonicalLocales(locale)[0];
    const base = canonical.split('-')[0];
    const languages = canonical === base ? [canonical] : [canonical, base];
    return { locale: canonical, languages, acceptLanguage: languages.map((value, i) => i ? `${value};q=0.9` : value).join(',') };
  }
}
