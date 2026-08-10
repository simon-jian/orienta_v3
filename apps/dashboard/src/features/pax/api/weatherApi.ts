import { apiUrl } from "../../../config/api";

export type WeatherIconKey =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy-day"
  | "partly-cloudy-night"
  | "cloudy"
  | "fog"
  | "rain"
  | "snow"
  | "thunderstorm"
  | "unknown";

export type AirportWeather = {
  available: true;
  temperature: number;
  temperature_unit: "C" | "F";
  weather_code: number;
  is_day: boolean;
  icon_key: WeatherIconKey;
  source: string;
  observed_at: string | null;
  cached?: boolean;
  stale?: boolean;
};

export async function fetchAirportWeather(airportCode: string): Promise<AirportWeather | null> {
  const code = (airportCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(code)) return null;
  try {
    const res = await fetch(apiUrl(`/api/airports/${encodeURIComponent(code)}/weather`));
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      weather?: { available?: boolean } & Partial<AirportWeather>;
    };
    if (!res.ok || !data.ok || !data.weather?.available) return null;
    return data.weather as AirportWeather;
  } catch {
    return null;
  }
}
