// API shapes of the carpools module (worker: domain.ts, app: card.tsx).

/** Search for a ride for a player; seats needed = 1 + companions. */
export interface CarpoolRequest {
  id: number;
  playerId: number;
  /** "First name L." */
  name: string;
  companions: number;
  seats: number;
  /** Booked with this offer, null = still searching */
  offerId: number | null;
  /** Own player or own child */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolOffer {
  id: number;
  personId: number;
  /** "First name L." of the driver */
  name: string;
  seats: number;
  free: number;
  riders: CarpoolRequest[];
  /** Own offer */
  mine: boolean;
  canEdit: boolean;
}

export interface CarpoolPersonRef {
  id: number;
  name: string;
}

/** Who can ride along: nominated players and the coaches (coach). */
export interface CarpoolRider extends CarpoolPersonRef {
  coach: boolean;
  /** Parents ("First name L.") as possible companions; only for the own family and for coaches */
  guardians: CarpoolPersonRef[];
}

export interface CarpoolInfo {
  /** Sign-up possible (game not cancelled and not started yet). */
  open: boolean;
  offers: CarpoolOffer[];
  /** People searching without a seat */
  waiting: CarpoolRequest[];
  /** Riders one searches for (own person, children), with their search */
  mine: { player: CarpoolRider & { self: boolean }; request: CarpoolRequest | null }[];
  /** The own person may offer to drive (no offer yet, family is not searching). */
  canOffer: boolean;
  /** Coaches and admins: sign up others. */
  coach: { drivers: CarpoolPersonRef[]; riders: CarpoolRider[] } | null;
}

/** On event cards: taken/offered seats, people searching without a seat. */
export interface CarpoolCount {
  taken: number;
  seats: number;
  waiting: number;
}
