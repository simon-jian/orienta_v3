import { Link, Navigate } from "react-router-dom";
import { getStoredPaxSession } from "./session";
import "./styles/pax.css";

/**
 * Branded passenger entry (robots `/pax?full=1` treatment) — personal service only.
 */
export default function PaxEntryPage() {
  if (getStoredPaxSession()?.token) {
    return <Navigate to="/pax/app" replace />;
  }

  return (
    <div className="pax-shell">
      <div className="pax-wrap">
        <p className="pax-chip ok" style={{ marginBottom: 16 }}>Orienta Passenger</p>
        <h1 className="pax-brand">Orienta</h1>
        <p className="pax-lead">
          个人机场导航与行程助手。扫登机牌或登录后，获取到登机口/出口时间、室内导航与通知。
        </p>

        <section className="pax-card">
          <h2>个人服务</h2>
          <p>
            使用手机领取航班绑定会话，查看行程估计，开始室内导航，并在安装 Web App 后接收离开提醒。
          </p>
          <Link className="pax-btn" to="/pax/login" style={{ display: "inline-block", textDecoration: "none" }}>
            继续
          </Link>
        </section>
      </div>
    </div>
  );
}
