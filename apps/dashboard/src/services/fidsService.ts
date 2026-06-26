export type FidsFlight = {
  flight: string;
  origin?: string;
  destination?: string;
  scheduledTime: string;
  status: string;
  gate?: string;
};

export const REFRESH_MS = 60 * 60 * 1000; // 1 hour

const MOCK_DEPARTURES: FidsFlight[] = [
  { flight: "CA783", destination: "Frankfurt",    scheduledTime: "3:28pm", status: "On Time",   gate: "E15" },
  { flight: "CA837", destination: "London",       scheduledTime: "3:45pm", status: "Boarding",  gate: "E19" },
  { flight: "CA781", destination: "Paris",        scheduledTime: "4:10pm", status: "Final Call",gate: "E22" },
  { flight: "CA831", destination: "Amsterdam",    scheduledTime: "4:50pm", status: "On Time",   gate: "E26" },
  { flight: "CA903", destination: "Tokyo",        scheduledTime: "4:20pm", status: "Boarding",  gate: "E12" },
  { flight: "CA935", destination: "Los Angeles",  scheduledTime: "5:30pm", status: "On Time",   gate: "E08" },
  { flight: "CA911", destination: "Sydney",       scheduledTime: "4:15pm", status: "Boarding",  gate: "E05" },
  { flight: "CA921", destination: "Seoul",        scheduledTime: "4:25pm", status: "Boarding",  gate: "E30" },
  { flight: "CA741", destination: "Manila",       scheduledTime: "2:50pm", status: "Departed",  gate: "E33" },
  { flight: "CA861", destination: "Singapore",    scheduledTime: "3:00pm", status: "Departed",  gate: "E36" },
];

const MOCK_ARRIVALS: FidsFlight[] = [
  { flight: "CA836", origin: "London",        scheduledTime: "1:20pm", status: "Landed",  gate: "E02" },
  { flight: "CA856", origin: "Frankfurt",     scheduledTime: "1:35pm", status: "Landed",  gate: "E04" },
  { flight: "CA901", origin: "Tokyo",         scheduledTime: "1:45pm", status: "Landed",  gate: "E06" },
  { flight: "CA902", origin: "Seoul",         scheduledTime: "1:50pm", status: "Landed",  gate: "E08" },
  { flight: "CA921", origin: "Sydney",        scheduledTime: "1:15pm", status: "Landed",  gate: "E10" },
  { flight: "CA931", origin: "Los Angeles",   scheduledTime: "1:10pm", status: "Landed",  gate: "E12" },
  { flight: "CA841", origin: "Paris",         scheduledTime: "1:30pm", status: "Landed",  gate: "E14" },
  { flight: "CA861", origin: "Amsterdam",     scheduledTime: "1:40pm", status: "Landed",  gate: "E16" },
  { flight: "UA851", origin: "San Francisco", scheduledTime: "3:28pm", status: "On Time", gate: "E18" },
  { flight: "LH720", origin: "Munich",        scheduledTime: "4:50pm", status: "On Time", gate: "E20" },
];

export async function fetchDepartures(_airport: string): Promise<FidsFlight[]> {
  return MOCK_DEPARTURES;
}

export async function fetchArrivals(_airport: string): Promise<FidsFlight[]> {
  return MOCK_ARRIVALS;
}
