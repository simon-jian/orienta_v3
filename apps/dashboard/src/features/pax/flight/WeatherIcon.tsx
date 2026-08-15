import type { WeatherIconKey } from "../api/weatherApi";

type Props = { iconKey: WeatherIconKey };

export function WeatherIcon({ iconKey }: Props) {
  return (
    <svg
      className="fdc-weather-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <WeatherGlyph iconKey={iconKey} />
    </svg>
  );
}

function WeatherGlyph({ iconKey }: Props) {
  switch (iconKey) {
    case "clear-day":
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </>
      );
    case "clear-night":
      return <path d="M19.5 15.6A8 8 0 0 1 8.4 4.5a8 8 0 1 0 11.1 11.1Z" />;
    case "partly-cloudy-day":
      return (
        <>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v2M2 8h2M3.8 3.8l1.4 1.4M15.5 18H6.8a3.8 3.8 0 0 1 .8-7.5A5 5 0 0 1 17 12a3 3 0 1 1-1.5 6Z" />
        </>
      );
    case "partly-cloudy-night":
      return (
        <>
          <path d="M13 3a5 5 0 0 1-6 6 5 5 0 0 0 6-6ZM15.5 18H6.8a3.8 3.8 0 0 1 .8-7.5A5 5 0 0 1 17 12a3 3 0 1 1-1.5 6Z" />
        </>
      );
    case "cloudy":
      return <path d="M17.5 19H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 13a3 3 0 1 1-.5 6Z" />;
    case "fog":
      return (
        <>
          <path d="M18 14H6a3.5 3.5 0 0 1 .7-6.9A5 5 0 0 1 16 8.5" />
          <path d="M4 18h16M7 21h10" />
        </>
      );
    case "rain":
      return (
        <>
          <path d="M17.5 15H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 9a3 3 0 1 1-.5 6Z" />
          <path d="m8 18-1 2M13 18l-1 2M18 18l-1 2" />
        </>
      );
    case "snow":
      return (
        <>
          <path d="M17.5 14H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 8a3 3 0 1 1-.5 6Z" />
          <path d="M8 18h.01M13 20h.01M18 18h.01" />
        </>
      );
    case "thunderstorm":
      return (
        <>
          <path d="M17.5 14H6a4 4 0 0 1 .8-7.9A6 6 0 0 1 18 8a3 3 0 1 1-.5 6Z" />
          <path d="m13 16-2 4h3l-2 3" />
        </>
      );
    default:
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.8 9a2.3 2.3 0 1 1 3.2 2.1c-1 .5-1 1.1-1 2M12 17h.01" />
        </>
      );
  }
}
