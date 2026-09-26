export class TimezoneProvider {
  static validate(timezone: string, country?: string): string {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    if (country) {
      // Use the runtime's ICU region data: country alone is not enough for multi-zone countries.
      const zones = (new Intl.Locale(`und-${country}`) as Intl.Locale & { timeZones?: string[] }).timeZones;
      const canonical = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
      if (!zones?.some(zone => new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone === canonical))
        throw new Error('Proxy timezone does not belong to the reported country');
    }
    return timezone;
  }
}
