// Kurze Neuigkeit auf der Terminübersicht (MotdBanner in src/howto.tsx) („Message of the Day“). Sie erscheint bis zum
// Ablaufdatum, und nur bis man sie auf dem Gerät wegklickt. Neue Neuigkeit: neue id.

export interface Motd {
  id: string;
  /** Letzter Tag der Anzeige (lokales Datum) */
  until: string;
  title: string;
  text: string;
}

export const MOTD: Motd | null = null;

/** Die Neuigkeit, falls sie heute gilt und auf diesem Gerät nicht weggeklickt wurde. */
export function activeMotd(motd: Motd | null, today: string, dismissed: (id: string) => boolean): Motd | null {
  return motd && today <= motd.until && !dismissed(motd.id) ? motd : null;
}

export const motdStorageKey = (id: string) => `kabine-motd-${id}`;
