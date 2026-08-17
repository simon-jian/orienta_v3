/**
 * Route-picker view of the shared indoor map airport list. Kept as its own
 * module so the pax nav code reads in its own vocabulary; the list itself lives
 * in config/indoorAirports.ts because the operator map switcher shares it.
 */
export {
  INDOOR_AIRPORTS as NAV_AIRPORTS,
  findIndoorAirport as findNavAirport,
  type IndoorAirport as NavAirport,
} from "../../../config/indoorAirports";
