export type AirportWeatherMetadata = {
  code: string;
  latitude: number;
  longitude: number;
  timezone: string;
  country: string | null;
};

const STATIC_AIRPORTS: Readonly<Record<string, AirportWeatherMetadata>> = {
  BOS: {
    code: "BOS",
    latitude: 42.3656,
    longitude: -71.0096,
    timezone: "America/New_York",
    country: "US",
  },
  KBOS: {
    code: "BOS",
    latitude: 42.3656,
    longitude: -71.0096,
    timezone: "America/New_York",
    country: "US",
  },
  SFO: {
    code: "SFO",
    latitude: 37.6155,
    longitude: -122.3866,
    timezone: "America/Los_Angeles",
    country: "US",
  },
  KSFO: {
    code: "SFO",
    latitude: 37.6155,
    longitude: -122.3866,
    timezone: "America/Los_Angeles",
    country: "US",
  },
  PEK: {
    code: "PEK",
    latitude: 40.0748162,
    longitude: 116.6061088,
    timezone: "Asia/Shanghai",
    country: "CN",
  },
  ZBAA: {
    code: "PEK",
    latitude: 40.0748162,
    longitude: 116.6061088,
    timezone: "Asia/Shanghai",
    country: "CN",
  },
};

const airportMetadataCache = new Map<string, AirportWeatherMetadata>();

export async function resolveAirportWeatherMetadata(
  airportCode: string,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<AirportWeatherMetadata | null> {
  const code = String(airportCode || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,4}$/.test(code)) return null;
  const staticMetadata = STATIC_AIRPORTS[code];
  if (staticMetadata) return staticMetadata;
  const cached = airportMetadataCache.get(code);
  if (cached) return cached;

  const apiKey = options.apiKey ||
    process.env.FLIGHTAWARE_API_KEY ||
    process.env.VITE_FLIGHTAWARE_API_KEY ||
    "";
  if (!apiKey) return null;

  const candidates = code.length === 3 ? [code, `K${code}`] : [code];
  for (const candidate of candidates) {
    try {
      const response = await (options.fetchImpl || fetch)(
        `https://aeroapi.flightaware.com/aeroapi/airports/${encodeURIComponent(candidate)}`,
        { headers: { "x-apikey": apiKey, Accept: "application/json" } },
      );
      if (!response.ok) continue;
      const data = await response.json() as Record<string, unknown>;
      const latitude = Number(data.latitude);
      const longitude = Number(data.longitude);
      const timezone = typeof data.timezone === "string" ? data.timezone.trim() : "";
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !timezone) continue;
      const metadata: AirportWeatherMetadata = {
        code: typeof data.code_iata === "string" ? data.code_iata : code,
        latitude,
        longitude,
        timezone,
        country:
          typeof data.country_code === "string"
            ? data.country_code
            : typeof data.country === "string"
              ? data.country
              : null,
      };
      airportMetadataCache.set(code, metadata);
      airportMetadataCache.set(candidate, metadata);
      return metadata;
    } catch {
      // Try the next provider-supported identifier.
    }
  }
  return null;
}
