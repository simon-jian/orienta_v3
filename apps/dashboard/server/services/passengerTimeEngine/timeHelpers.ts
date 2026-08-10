import {
  CongestionLevel,
  EstimateConfidence,
  type MinuteRange,
} from "./types";

export function parseInstant(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function formatInTimeZone(
  instant: Date,
  timeZone: string,
  locale = "en-US",
): string {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  return new Intl.DateTimeFormat(locale, {
    timeZone: safeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

export function sumRanges(ranges: readonly MinuteRange[]): MinuteRange {
  return ranges.reduce(
    (total, range) => ({
      min: total.min + Math.max(0, range.min),
      max: total.max + Math.max(range.min, range.max, 0),
    }),
    { min: 0, max: 0 },
  );
}

export function expectedFromRange(range: MinuteRange): number {
  const min = Math.max(0, range.min);
  const max = Math.max(min, range.max, 0);
  return Math.round((min + max) / 2);
}

export function sumExpected(ranges: readonly MinuteRange[]): number {
  return ranges.reduce((total, range) => total + expectedFromRange(range), 0);
}

export type NarrowRangeProfile = {
  journey: "gate" | "exit";
  domestic: boolean;
  hasBags: boolean;
  international: boolean;
};

/**
 * Build a decision-usable total band around expected_total.
 * Uses the dominant stage uncertainty plus a limited secondary margin,
 * instead of summing every component min/max. Abnormal low-confidence
 * cases keep a wider band rather than being hard-truncated.
 */
export function narrowTotalRange(
  expectedTotal: number,
  stageRanges: readonly MinuteRange[],
  confidence: EstimateConfidence,
  profile: NarrowRangeProfile,
): MinuteRange {
  const center = Math.max(0, Math.round(expectedTotal));
  const active = stageRanges.filter((range) => range.min !== 0 || range.max !== 0);
  if (center === 0 && active.length === 0) {
    return { min: 0, max: 0 };
  }

  const halfWidths = active
    .map((range) => Math.max(0, (Math.max(range.min, range.max) - Math.max(0, range.min)) / 2))
    .sort((a, b) => b - a);
  const dominantHalf = halfWidths[0] ?? 0;
  const secondaryHalf = halfWidths.slice(1).reduce((sum, value) => sum + value, 0) * 0.2;
  const derivedHalf = dominantHalf + secondaryHalf;

  let targetWidth: number;
  if (profile.journey === "exit") {
    if (profile.domestic && !profile.hasBags) {
      targetWidth = confidence === EstimateConfidence.High ? 10 : confidence === EstimateConfidence.Medium ? 12 : 14;
    } else if (profile.domestic) {
      targetWidth = confidence === EstimateConfidence.High ? 14 : confidence === EstimateConfidence.Medium ? 18 : 22;
    } else {
      targetWidth = confidence === EstimateConfidence.High ? 18 : confidence === EstimateConfidence.Medium ? 24 : 30;
    }
  } else if (confidence === EstimateConfidence.High) {
    targetWidth = 12;
  } else if (confidence === EstimateConfidence.Medium) {
    targetWidth = 18;
  } else {
    targetWidth = 24;
  }

  const abnormalHalf = derivedHalf;
  const targetHalf = targetWidth / 2;
  // Prefer the planning target when risk is modest; keep abnormal risk visible when dominant uncertainty is large.
  const half = Math.round(
    confidence === EstimateConfidence.Low || abnormalHalf > targetHalf + 4
      ? Math.max(targetHalf, Math.min(abnormalHalf, profile.international ? 20 : 14))
      : targetHalf,
  );
  return {
    min: Math.max(0, center - half),
    max: center + half,
  };
}

export function scaleRange(range: MinuteRange, multiplier: number): MinuteRange {
  return {
    min: Math.max(0, Math.round(range.min * multiplier)),
    max: Math.max(0, Math.round(range.max * multiplier)),
  };
}

export function rangeFromKnownTarget(now: Date, target: Date, uncertainty = 0): MinuteRange {
  const minutes = Math.max(0, Math.round(minutesBetween(now, target)));
  return {
    min: Math.max(0, minutes - uncertainty),
    max: minutes + uncertainty,
  };
}

export function elevateCongestion(level: CongestionLevel): CongestionLevel {
  if (level === CongestionLevel.Light) return CongestionLevel.Normal;
  if (level === CongestionLevel.Normal) return CongestionLevel.Busy;
  if (level === CongestionLevel.Busy) return CongestionLevel.VeryBusy;
  return level;
}

/** Classifies the supplied flight reference instant in the airport's local time. */
export function classifyScheduledCongestion(
  referenceInstant: Date | null,
  timeZone: string | null,
  escalate = false,
): CongestionLevel {
  if (!referenceInstant || !isValidTimeZone(timeZone)) return CongestionLevel.Unknown;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(referenceInstant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const weekday = part("weekday");
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !weekday) {
    return CongestionLevel.Unknown;
  }
  const clock = hour * 60 + minute;
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  let level: CongestionLevel;
  if (clock < 300 || clock >= 1380) {
    level = CongestionLevel.Light;
  } else if (isWeekend) {
    level =
      clock < 540
        ? CongestionLevel.Normal
        : clock < 1080
          ? CongestionLevel.Busy
          : CongestionLevel.Normal;
  } else {
    level =
      clock < 510
        ? CongestionLevel.Busy
        : clock < 930
          ? CongestionLevel.Normal
          : clock < 1170
            ? CongestionLevel.Busy
            : CongestionLevel.Normal;
  }
  return escalate ? elevateCongestion(level) : level;
}
