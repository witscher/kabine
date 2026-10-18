// Short news item on the event overview (MotdBanner in src/howto.tsx) ("message of the day"). It appears until the
// expiry date, and only until it is dismissed on the device. New news item: new id.

export interface Motd {
  id: string;
  /** Last day of display (local date) */
  until: string;
  title: string;
  text: string;
}

export const MOTD: Motd | null = null;

/** The news item, if it applies today and was not dismissed on this device. */
export function activeMotd(motd: Motd | null, today: string, dismissed: (id: string) => boolean): Motd | null {
  return motd && today <= motd.until && !dismissed(motd.id) ? motd : null;
}

export const motdStorageKey = (id: string) => `kabine-motd-${id}`;
