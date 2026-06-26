import type { PaxExtStatus } from "../types/types";

export const STATUS_COLORS: Record<string, string> = {
  green:   "#34c759",
  yellow:  "#ffcc00",
  red:     "#ff3b30",
  lost:    "#ff9f0a",
  offline: "#636366",
  missed:  "#8e8e93",
  gray:    "#8e8e93",
};

export function statusBadge(s: PaxExtStatus | string): string {
  return STATUS_COLORS[s] || "#8e8e93";
}

export function extStatusLabel(s: PaxExtStatus): string {
  const labels: Record<PaxExtStatus, string> = {
    green:   "On Track",
    yellow:  "Tight",
    red:     "At Risk",
    missed:  "Missed",
    offline: "Offline",
    lost:    "Lost",
    gray:    "Unknown",
  };
  return labels[s] || s;
}
