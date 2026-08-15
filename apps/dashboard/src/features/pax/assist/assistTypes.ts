export type AssistTab = "assist" | "nav";

export type RobotServiceType = "follow" | "um" | "wheelchair" | "lost_delivery";
export type RobotRequestStatus = "submitted" | "assigned" | "en_route" | "serving" | "cancelled";

export type RobotServiceOption = {
  id: RobotServiceType;
  title: string;
  blurb: string;
};

export const ROBOT_SERVICES: RobotServiceOption[] = [
  { id: "follow", title: "跟随服务", blurb: "旅客站到机器人前方，识别锁定后自动跟随" },
  { id: "um", title: "UM 无人陪", blurb: "儿童资料、证件核验、交接责任链" },
  { id: "wheelchair", title: "特殊协助", blurb: "轮椅、急客、老人、语言或医疗协助" },
  { id: "lost_delivery", title: "楼内递送", blurb: "证件、药品、失物、小件物品递送" },
];

export type RobotRequest = {
  id: string;
  serviceType: RobotServiceType;
  partySize: number;
  origin: string;
  destination: string;
  note: string;
  status: RobotRequestStatus;
  createdAt: number;
  updatedAt: number;
};

export type AssistInfoStrip = {
  inbound: string;
  outbound: string;
  gate: string;
  status: string;
};

export function robotStatusLabel(status: RobotRequestStatus | "idle"): string {
  switch (status) {
    case "idle":
      return "未预约";
    case "submitted":
      return "已提交";
    case "assigned":
      return "已分配";
    case "en_route":
      return "前往中";
    case "serving":
      return "服务中";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function fmtAssistTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
