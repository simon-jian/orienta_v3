/** Mirror of pedestrian_dead_reckoning/js/airports.js (picker labels + terminals). */
export type NavAirport = {
  code: string;
  label: string;
  lat: number;
  lng: number;
  terminals: string[];
};

export const NAV_AIRPORTS: NavAirport[] = [
  { code: "PEK", label: "PEK 北京首都", lat: 40.0724, lng: 116.6142, terminals: ["T3E", "T3D", "T3C", "T2", "T1"] },
  { code: "SZX", label: "SZX 深圳宝安", lat: 22.6395, lng: 113.8107, terminals: ["卫星厅", "3号航站楼"] },
  { code: "NKG", label: "NKG 南京禄口", lat: 31.742, lng: 118.866, terminals: ["T2", "T1"] },
  { code: "SFO", label: "SFO 旧金山", lat: 37.6188, lng: -122.3853, terminals: ["International", "Terminal 1", "Terminal 2", "Terminal 3"] },
  { code: "SJC", label: "SJC 圣何塞", lat: 37.3639, lng: -121.9289, terminals: ["Terminal A", "Terminal B"] },
  { code: "PVD", label: "PVD 普罗维登斯", lat: 41.7238, lng: -71.4281, terminals: ["Main Terminal"] },
  { code: "BOS", label: "BOS 波士顿洛根", lat: 42.3656, lng: -71.0096, terminals: ["Terminal A", "Terminal B", "Terminal C", "Terminal E"] },
  { code: "DEN", label: "DEN 丹佛国际", lat: 39.8492, lng: -104.6738, terminals: ["Jeppesen Terminal", "Concourse A", "Concourse B", "Concourse C"] },
  { code: "PLE", label: "Pleasanton（测试）", lat: 37.6624, lng: -121.8747, terminals: ["测试区域"] },
];

export function findNavAirport(code: string | undefined | null): NavAirport | null {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  return NAV_AIRPORTS.find((a) => a.code === c) || null;
}
