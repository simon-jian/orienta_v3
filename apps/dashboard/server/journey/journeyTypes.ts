export type JourneyEventType = "off_plane" | "bags_collected" | "outside";

export interface JourneyKey {
  flightIdentifier: string;
  flightDate: string;
}

export interface JourneyPreferences extends JourneyKey {
  checkedBags: boolean | null;
  departureSecurityLane: string | null;
  arrivalSeat: string | null;
  arrivalSeatZone: string | null;
  arrivalDestination: string | null;
  immigrationLane: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type JourneyPreferencesUpdate = Partial<
  Pick<
    JourneyPreferences,
    | "checkedBags"
    | "departureSecurityLane"
    | "arrivalSeat"
    | "arrivalSeatZone"
    | "arrivalDestination"
    | "immigrationLane"
  >
>;

export interface JourneyEvent extends JourneyKey {
  id: string;
  eventType: JourneyEventType;
  eventRank: number;
  source: string;
  eventTime: string;
  correctedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddJourneyEvent {
  eventType: JourneyEventType;
  source: string;
  eventTime?: string | Date;
}

export interface PublicJourneyPreferences {
  checkedBags: boolean | null;
  departureSecurityLane: string | null;
  arrivalSeatZone: string | null;
  arrivalDestination: string | null;
  immigrationLane: string | null;
}

export interface PublicArrivalPlanShare extends JourneyKey {
  shareId: string;
  expiresAt: string;
  lastAccessedAt: string | null;
  preferences: PublicJourneyPreferences;
  events: JourneyEvent[];
}

export type CreateOrReuseShareResult =
  | {
      status: "created";
      shareId: string;
      publicToken: string;
      managementToken: string;
      expiresAt: string;
    }
  | {
      status: "reused";
      shareId: string;
      expiresAt: string;
    };
