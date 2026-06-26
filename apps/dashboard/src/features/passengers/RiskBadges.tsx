import { STATUS_COLORS } from "../../utils/statusDisplay";

type Props = { counts: Record<string, number> };

const ITEMS: { key: string; label: string }[] = [
  { key: "green",   label: "On Track" },
  { key: "yellow",  label: "Tight"    },
  { key: "red",     label: "At Risk"  },
  { key: "lost",    label: "Lost"     },
  { key: "offline", label: "Offline"  },
  { key: "missed",  label: "Missed"   },
];

export default function RiskBadges({ counts }: Props) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      {ITEMS.map((i) => (
        <div
          key={i.key}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "rgba(255,255,255,0.06)", borderRadius: 8, padding: "4px 10px",
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, color: STATUS_COLORS[i.key] }}>
            {counts[i.key] || 0}
          </span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>{i.label}</span>
        </div>
      ))}
    </div>
  );
}
