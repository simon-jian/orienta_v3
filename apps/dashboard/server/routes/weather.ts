/**
 * Airport weather for the passenger flight card (Open-Meteo via WeatherService).
 * Optional enhancement — never throws a 5xx for provider failures.
 */
import type { Router, Request, Response } from "express";
import { normalizeFlight } from "../services/flightAware";
import { resolveAirportWeatherMetadata } from "../services/weather/airportMetadata";
import { createWeatherServiceFromEnv } from "../services/weather/weatherService";

const weatherService = createWeatherServiceFromEnv();

export function registerWeatherRoutes(router: Router): void {
  router.get("/airports/:airportCode/weather", async (req: Request, res: Response) => {
    const airportCode = normalizeFlight(req.params.airportCode || "");
    if (!airportCode || !/^[A-Z0-9]{3,4}$/.test(airportCode)) {
      return res.status(400).json({ ok: false, error: "invalid_airport" });
    }

    let weather: Awaited<ReturnType<typeof weatherService.getAirportWeather>> = { available: false };
    try {
      const metadata = await resolveAirportWeatherMetadata(airportCode);
      if (metadata) {
        weather = await weatherService.getAirportWeather({
          airportCode: metadata.code || airportCode,
          latitude: metadata.latitude,
          longitude: metadata.longitude,
          timezone: metadata.timezone,
          airportCountry: metadata.country,
          userPreference: typeof req.query.unit === "string" ? req.query.unit : null,
        });
      }
    } catch {
      // Weather is optional; keep unavailable response.
    }

    return res.json({
      ok: true,
      weather,
      attribution: weatherService.attribution,
    });
  });
}
