import { OpenMeteoProvider } from "./openMeteoProvider";
import type {
  AvailableWeatherResult,
  TemperatureUnit,
  WeatherProvider,
  WeatherResult,
} from "./types";

export type AirportWeatherRequest = {
  airportCode: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  timezone: string | null | undefined;
  airportCountry?: string | null;
  userPreference?: string | null;
};

type CacheEntry = {
  storedAt: number;
  value: AvailableWeatherResult;
};

export function getTemperatureUnit(
  airportCountry: string | null | undefined,
  userPreference?: string | null,
): TemperatureUnit {
  const preference = String(userPreference || "").trim().toLowerCase();
  if (preference === "f" || preference === "fahrenheit") return "fahrenheit";
  if (preference === "c" || preference === "celsius") return "celsius";
  return String(airportCountry || "").trim().toUpperCase() === "US"
    ? "fahrenheit"
    : "celsius";
}

export class WeatherService {
  readonly attribution: WeatherProvider["attribution"];
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<WeatherResult>>();

  constructor(
    private readonly options: {
      provider: WeatherProvider;
      enabled?: boolean;
      cacheTtlMs?: number;
      staleCacheMs?: number;
      now?: () => number;
    },
  ) {
    this.attribution = options.provider.attribution;
  }

  async getAirportWeather(request: AirportWeatherRequest): Promise<WeatherResult> {
    const latitude = Number(request.latitude);
    const longitude = Number(request.longitude);
    const timezone = String(request.timezone || "").trim();
    if (
      this.options.enabled === false ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !timezone
    ) {
      return { available: false };
    }

    const unit = getTemperatureUnit(request.airportCountry, request.userPreference);
    const airportCode = String(request.airportCode || "").trim().toUpperCase();
    const cacheKey = `weather:${this.options.provider.id}:${airportCode}:${unit}`;
    const now = (this.options.now || Date.now)();
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.storedAt <= (this.options.cacheTtlMs ?? 900_000)) {
      return { ...cached.value, cached: true };
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const refresh = this.options.provider.getCurrentWeather({
      latitude,
      longitude,
      timezone,
      temperature_unit: unit,
    }).then((value) => {
      const normalized = { ...value, cached: false } satisfies AvailableWeatherResult;
      this.cache.set(cacheKey, { storedAt: (this.options.now || Date.now)(), value: normalized });
      return normalized;
    }).catch((): WeatherResult => {
      const staleAge = cached ? now - cached.storedAt : Number.POSITIVE_INFINITY;
      if (cached && staleAge <= (this.options.staleCacheMs ?? 7_200_000)) {
        return { ...cached.value, cached: true, stale: true };
      }
      return { available: false };
    }).finally(() => {
      this.inFlight.delete(cacheKey);
    });

    this.inFlight.set(cacheKey, refresh);
    return refresh;
  }
}

function envSeconds(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function createWeatherServiceFromEnv(): WeatherService {
  const providerName = String(process.env.WEATHER_PROVIDER || "open_meteo").toLowerCase();
  const enabled = String(process.env.WEATHER_ENABLED || "true").toLowerCase() !== "false";
  const provider = new OpenMeteoProvider({
    baseUrl: process.env.OPEN_METEO_BASE_URL,
    timeoutMs: envSeconds("WEATHER_TIMEOUT_SECONDS", 5) * 1_000,
  });

  return new WeatherService({
    provider,
    enabled: enabled && providerName === "open_meteo",
    cacheTtlMs: envSeconds("WEATHER_CACHE_TTL_SECONDS", 900) * 1_000,
    staleCacheMs: envSeconds("WEATHER_STALE_CACHE_SECONDS", 7_200) * 1_000,
  });
}
