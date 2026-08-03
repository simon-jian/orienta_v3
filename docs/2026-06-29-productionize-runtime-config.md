# 2026-06-29 — Demo 清理 + 机场配置运行时加载

> 范围：`apps/dashboard`
> 目标：把产品从「带 demo 的演示版」推进到 production；并把机场/航司参数从 TypeScript 源码搬到**数据文件（YAML）**，做到「加一个机场 = 丢一个文件 + 重启」，不改代码、不用重新编译。

相关提交：

- `7f9c382` Productionize: remove demo data and legacy passenger auth
- `b178fa8` Productionize: delete legacy static passenger pages
- `a3f7d25` Multi-airport: load airport/tenant config from data files at runtime

---

## 一、这次改了什么

### A. Demo / 演示内容清理（production 化）

- **管理后台**
  - 删除 Dashboard 的 "Pax Simulator" 面板及 `PEK_SIM_PAX`。
  - `LoginScreen` 去掉预填账号、SSO mock、demo 提示文案、"国航 Demo" 品牌字样。
  - 服务端删除 demo 管理登录开关 `ALLOW_DEMO_LOGIN`（原来的 `demo:demo`）。
- **乘客侧认证**
  - 删除 legacy 乘客认证 `PAX_LEGACY_AUTH` 与 `PEK_PREMIUM_IDS`；聊天/身份解析现在**强制要求 JWT**（无 token 直接 401）。
  - `paxCanSendChat` 改为只看 `claims.capabilities`；plan 不再由 demo 名单推断。
- **航班 / FIDS 改为 live-only**
  - 删除 demo 航班数据（`src/data/airports/pek.demo.ts`）与 registry 里的 `demo` 配置/类型。
  - 客户端 `flightService` / `fidsService` 在没有实时数据源时返回**空**（不再回退到 demo 数据）。
  - 服务端 `fidsService` 的 `static` 回退改为 `fallback`：无 FlightAware key 时给通用默认 gate、空目的地。
  - ⚠️ 直接后果：在接入真实数据源之前，航班板/FIDS 面板是空的（符合「不要 demo」的要求）。
- **legacy 静态乘客页**
  - 删除 `public/pax.html`、`pax-flight.html`、`pax-login.html`、`pax-route-video.html` 及 `PaxEntryWrapper`、dev-only 入口/链接。
  - 删除 `legacyPaxHref`、`legacyPaxQuery` 等相关代码。
  - **保留** `route_site`（AR 视频导航）。
  - 规范乘客 UI 统一为 React 的 `/pax/app`（`PaxAppPage`）。
- **环境变量 / 文档**
  - 从 `.env.example`、`deploy.example.env`、`docker-compose.yml`、`README.md` 移除 `ORIENTA_ALLOW_DEMO`、`PAX_LEGACY_AUTH`，更新 `FLIGHTAWARE_API_KEY` 说明。

### B. 机场/航司配置：改为运行时数据加载（Model B）

这是市面 production 系统的主流做法：**配置即数据**，与代码解耦。

- **数据源（唯一真相）**
  - `config/airports/pek.yaml`
  - `config/tenants/airchina.yaml`
- **校验与类型转换** — `src/config/airports/schema.ts`
  - 用 zod 校验 YAML/JSON 输入；把可序列化形式（`gatePattern` 用字符串）编译成运行时 `AirportDefinition`（正则编译成 `RegExp`）。
- **服务端启动加载** — `server/config/loadConfig.ts`
  - 启动时读 `config/airports/*.yaml` + `config/tenants/*.yaml`，校验后 hydrate 共享 registry。
  - 目录可用 `AIRPORT_CONFIG_DIR` 覆盖（默认 `process.cwd()/config`）。
  - 新增 API：`GET /api/config/bootstrap` 返回所有机场/租户的可序列化配置。
- **客户端启动加载** — `src/config/bootstrap.ts` + `src/main.tsx`
  - App 渲染前先 `fetch` bootstrap 并 hydrate registry；`App` 用 dynamic import，确保配置就绪后才求值（构建产物里 `App` 已是独立 chunk）。
  - 失败时优雅降级到内置 fallback，应用仍能渲染。
- **registry 改为可 hydrate**
  - `src/config/airports/registry.ts` / `src/config/tenants/registry.ts`：用 `setAirports` / `setTenants` 注入，删除静态 import。
  - 默认机场/租户 id、客户端默认值改为**函数**（`defaultAirportId()`、`clientDefaultAirportId()` 等），避免 import 期读到未 hydrate 的值。
- **删除** 写死的 `src/config/airports/pek.config.ts`。

### C. 验证

- server typecheck ✅ ／ client build ✅ ／ 29 个单测全过 ✅
- 实跑 loader 确认 PEK 从 YAML 正确加载、`gatePattern` 正确编译为正则、`airchina → PEK` 映射正确。

---

## 二、如何新增一个机场 / 航司（新工作流）

1. 新增 `config/airports/<iata>.yaml`（参考 `pek.yaml`）。
2. 新增 `config/tenants/<tenant>.yaml`（参考 `airchina.yaml`，`airportId` 指向上面的机场）。
3. 重启服务端。完成 —— 无需改代码、无需重新构建客户端。

---

## 三、后续还要做什么（TODO）

### 🔴 高优先级（接入真实数据前是空壳）

- [ ] **接入实时航班数据源**。当前 FIDS / flightService 是 live-only，没有数据源就是空的。
  - 选项：FlightAware AeroAPI（已有 `FLIGHTAWARE_API_KEY` 钩子）或机场自有 FIDS feed。
  - 服务端 `fidsService` 的 `fallback` 分支需要换成真实拉取 + 缓存。
- [ ] **乘客 JWT 签发链路**端到端验证：现在聊天/身份强制 JWT，需确认正式签发/校验流程（capabilities、过期、刷新）完整可用。

### 🟡 中优先级（多机场真正落地）

- [ ] 给配置加**第二个机场样例**，端到端验证 registry / bootstrap / 地图中心 / 网关正则在多 hub 下都正确。
- [ ] `route_site` 仍读 `config/pek.json`：把它纳入同一套 YAML 配置体系（或至少由 `?hub=`/`?airport=` 完整驱动），避免两套配置真相。
- [ ] 配置文件的**热加载 / 校验失败可观测性**：当前校验失败会抛错；考虑启动期清晰报错 + 健康检查里暴露已加载的 hub 列表。
- [ ] `config/airports/*.yaml` 加 **schema 文档 / JSON Schema**，方便他人填写时有提示和校验。

### 🟢 低优先级（打磨）

- [ ] 清理 `HARDCODED_VALUES.md` 中已过期的条目（很多 demo / `pek.config.ts` / `PAX_LEGACY_AUTH` 描述已不再适用），同步到当前代码状态。
- [ ] 残留的品牌/文案硬编码（`/airchina-logo.png`、admin display name、启动日志里的 `pid=TX1` 等）可由 tenant 配置驱动。
- [ ] 给「新增机场」流程补一份正式 README / 模板生成脚本。

---

## 四、注意事项 / 已知影响

- **航班板为空是预期行为**，直到接入真实数据源。
- 机场配置改动后**需要重启服务端**才生效（非热加载）。
- `AIRPORT_CONFIG_DIR` 可指向外部配置目录（部署时把 YAML 放在镜像外、挂载进来更灵活）。
- 客户端依赖 `GET /api/config/bootstrap`；若该接口失败，会退回内置 fallback 配置（功能受限但不白屏）。
