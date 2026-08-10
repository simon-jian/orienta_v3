export type TemperatureUnit = "fahrenheit" | "celsius";
export type TemperatureUnitSymbol = "F" | "C";

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

export type AvailableWeatherResult = {
  available: true;
  temperature: number;
  temperature_unit: TemperatureUnitSymbol;
  weather_code: number;
  is_day: boolean;
  icon_key: WeatherIconKey;
  source: string;
  observed_at: string | null;
  cached: boolean;
  stale?: boolean;
};

export type UnavailableWeatherResult = {
  available: false;
  cached?: false;
};

export type WeatherResult = AvailableWeatherResult | UnavailableWeatherResult;

export type CurrentWeatherRequest = {
  latitude: number;
  longitude: number;
  timezone: string;
  temperature_unit: TemperatureUnit;
};

export interface WeatherProvider {
  readonly id: string;
  readonly attribution: { label: string; url: string };
  getCurrentWeather(request: CurrentWeatherRequest): Promise<AvailableWeatherResult>;
}
