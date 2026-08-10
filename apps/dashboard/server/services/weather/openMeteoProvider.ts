import type {
  AvailableWeatherResult,
  CurrentWeatherRequest,
  WeatherIconKey,
  WeatherProvider,
} from "./types";

type FetchLike = typeof fetch;

export function mapOpenMeteoCodeToIcon(weatherCode: number, isDay: boolean): WeatherIconKey {
  if (weatherCode === 0) return isDay ? "clear-day" : "clear-night";
  if (weatherCode === 1 || weatherCode === 2) {
    return isDay ? "partly-cloudy-day" : "partly-cloudy-night";
  }
  if (weatherCode === 3) return "cloudy";
  if (weatherCode === 45 || weatherCode === 48) return "fog";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) {
    return "rain";
  }
  if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snow";
  if ([95, 96, 99].includes(weatherCode)) return "thunderstorm";
  return "unknown";
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly id = "open-meteo";
  readonly attribution = {
    label: "Open-Meteo",
    url: "https://open-meteo.com/",
  };

  constructor(
    private readonly options: {
      baseUrl?: string;
      timeoutMs?: number;
      fetchImpl?: FetchLike;
      warn?: (message: string) => void;
    } = {},
  ) {}

  async getCurrentWeather(request: CurrentWeatherRequest): Promise<AvailableWeatherResult> {
    const url = new URL(
      this.options.baseUrl || "https://api.open-meteo.com/v1/forecast",
    );
    url.search = new URLSearchParams({
      latitude: String(request.latitude),
      longitude: String(request.longitude),
      current: "temperature_2m,weather_code,is_day",
      temperature_unit: request.temperature_unit,
      timezone: request.timezone,
    }).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5_000);
    try {
      const response = await (this.options.fetchImpl || fetch)(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "OrientaPassengerWeather/1.0",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          (this.options.warn || console.warn)(
            `Open-Meteo current weather request failed with HTTP ${response.status}`,
          );
        }
        throw new Error(`weather_provider_http_${response.status}`);
      }

      const payload = await response.json() as {
        current?: {
          temperature_2m?: unknown;
          weather_code?: unknown;
          is_day?: unknown;
          time?: unknown;
        };
      };
      const temperature = Number(payload.current?.temperature_2m);
      const weatherCode = Number(payload.current?.weather_code);
      const rawIsDay = payload.current?.is_day;
      if (
        !payload.current ||
        !Number.isFinite(temperature) ||
        !Number.isFinite(weatherCode) ||
        (rawIsDay !== 0 && rawIsDay !== 1 && rawIsDay !== false && rawIsDay !== true)
      ) {
        throw new Error("weather_provider_invalid_payload");
      }
      const isDay = rawIsDay === 1 || rawIsDay === true;

      return {
        available: true,
        temperature: Math.round(temperature),
        temperature_unit: request.temperature_unit === "fahrenheit" ? "F" : "C",
        weather_code: weatherCode,
        is_day: isDay,
        icon_key: mapOpenMeteoCodeToIcon(weatherCode, isDay),
        source: this.id,
        observed_at: typeof payload.current.time === "string" ? payload.current.time : null,
        cached: false,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
