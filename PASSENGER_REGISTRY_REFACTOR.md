# 旅客管理层 Refactor 工作记录

> 上次工作：2026-06-08  
> 项目：`orienta_v3/apps/dashboard`  
> 目标：生产部署（国航云），替换硬编码 demo 旅客数据

---

## 已完成（Phase 1）

### 核心目标
> "当有一个旅客在前端登录或查询时，才创建一个 passenger 给他。"

实现方式：旅客通过 WebSocket 发送 `hello` 时，服务端 `PassengerRegistry` 自动创建/更新旅客记录。

### 新增文件

#### `server/passengers/PassengerRegistry.ts`
SQLite 旅客注册表，核心 API：

```typescript
registry.getOrCreate(input)   // pax hello 时调用，幂等
registry.get(tenantId, id)
registry.list(tenantId)       // GET /api/passengers 用
registry.update(tenantId, id, patch)  // 运营人员覆盖状态
registry.delete(tenantId, id)
registry.markOnline(tenantId, id)   // WS 连接时
registry.markOffline(tenantId, id)  // WS 断开时
```

- 数据库路径：`DB_PATH` env var（默认 `./data/passengers.db`）
- 旅客创建时自动在目标登机口附近随机分配初始位置
- 不存储 `path`/`pathIndex`（纯 sim 状态，由前端重新生成）

#### `server/routes/passengers.ts`
管理端 REST API，均需 admin JWT cookie：

| 端点 | 说明 |
|---|---|
| `GET /api/passengers?tenant=airchina` | 列出所有旅客，自动从 `buildPekFlights()` 补全 `outboundDep` |
| `POST /api/passengers` | 预注册旅客（字段：`id`, `flightId`, `gateId`, `name`, `plan`...） |
| `PATCH /api/passengers/:id` | 覆盖 `extStatus`/`activity`/`plan`/`needsWheelchair` 等 |
| `DELETE /api/passengers/:id` | 清理 |

#### `public/pax.html`（新增到 v3）
从 `orienta_v2_step2/vite/public/` 复制，修改了 WS hello：

```js
// 修改前
{ type: "hello", role: "pax", tenantId, passengerId, displayName, plan }

// 修改后
{ type: "hello", role: "pax", tenantId, passengerId,
  displayName, name, plan,
  flightId:        params.get("dep")...,      // 出发航班 CA837
  gateId:          gateToNav,                 // 登机口 E19
  inboundFlightId: params.get("arr")...,      // 进港航班 CA836
  locale:          navigator.language,
}
```

同步复制了 `pax-login.html`, `pax-flight.html`, `pax-route-video.html`。

### 修改文件

| 文件 | 变更摘要 |
|---|---|
| `server/config.ts` | 新增 `DB_PATH` env var |
| `server/routes/auth.ts` | 导出 `requireAdmin` middleware |
| `server/hub/wsHub.ts` | `attachWsHub()` 接受第三个参数 `registry?`；pax hello → `getOrCreate` + `markOnline`；close → `markOffline` |
| `server/server.ts` | 实例化 `PassengerRegistry(DB_PATH)`，传入 hub 和路由 |
| `src/sim/airports/pek.ts` | 新增 `demoFlightsForPid(pid)` — 从 `PEK_SCENARIOS` 推导 dep/arr |
| `src/components/PaxEntryWrapper.tsx` | `buildPaxHtmlSrc` + `buildPaxDialogVideoSrc` 调用 `demoFlightsForPid`，把 `dep`/`arr` 注入 pax.html URL |
| `src/features/passengers/useDashboard.ts` | PEK 从 `GET /api/passengers` 加载；每 10s 轮询新旅客；SFO 保留 `buildSFOWorld()` |
| `src/app/Dashboard.tsx` | 移除 `buildPekWorld` import 和 `buildWorld` prop |

---

## 数据流（当前）

```
旅客扫码/访问 URL
  ?pix=TX1&tenant=airchina&dep=CA837&gateTo=E19
       ↓
  PaxEntryWrapper → 拼接 pax.html URL（含 dep, arr, gateTo）
       ↓
  pax.html 加载，WS 连接
       ↓
  hello: { passengerId, flightId, gateId, locale, ... }
       ↓
  wsHub.ts → PassengerRegistry.getOrCreate()
                  ↓
              SQLite passengers 表
                  ↓
  admin poll GET /api/passengers → enrichWithFlightTime() → Passenger[]
       ↓
  useDashboard: assignSimPaths() → stepWorld() tick → computePassenger()
       ↓
  Dashboard UI 显示
```

---

## 待做（Phase 2）

### 高优先级

#### 1. pax.html → 完全去除硬编码 `PAX_DATA`
**现状**：pax.html 里有 `PAX_DATA` 对象（TX1/TX2/TX3/P8/P11 的 name、plan、gate），用于页面显示。新旅客用默认值 `{ name: passengerId, plan: "free", ... }`。

**目标**：pax.html 加载后从服务器拉取旅客自己的数据：
```js
GET /api/pax/me?passengerId=TX1&tenant=airchina
→ { name, plan, flightId, gateId, ... }
```
这需要先有旅客侧认证（见下）。

#### 2. `POST /api/pax/login` — 旅客侧认证
**现状**：服务器完全信任 URL 里的 `passengerId`，无身份验证。

**目标**：
```
POST /api/pax/login
Body: { flightId: "CA837", name: "ZHANG/WEI", tenantId: "airchina" }
  或: { bcbp: "M1ZHANG/WEI...", tenantId: "airchina" }

→ { ok: true, passengerId: "uuid-xxx", sessionToken: "tok_xxx" }
```
pax.html 收到 token 后，WS hello 改为带 token：
```js
{ type: "hello", role: "pax", sessionToken: "tok_xxx", tenantId }
```
服务器验证 token → 查出 passengerId。

#### 3. BCBP 登机牌解析
**现状**：无。

**目标**：`server/passengers/bcbpParser.ts` 解析 IATA BCBP 格式：
```
M1ZHANG/WEI          EABCDEF PEKFRACA  837 167 Y001A00012503
```
提取：姓名、PNR、出发地、目的地、航班号、座位号。
供 `POST /api/pax/scan` 端点使用。

#### 4. 航班舱单导入
**现状**：旅客只能连接时自动创建，或管理员逐个 POST。

**目标**：
```
POST /api/passengers/import
Content-Type: text/csv  (或 application/json)

id,name,nationality,flightId,gateId,plan,needsWheelchair
TX1,SIYAO FU,CN,CA837,E19,premium,false
TX2,SOPHIE CHEN,HK,CA837,E19,premium,false
...
```
支持批量预注册航班所有旅客。

#### 5. SQLite → PostgreSQL
**现状**：`better-sqlite3`，单文件 `./data/passengers.db`。

**目标**：国航云集群部署需要 PostgreSQL。
- `PassengerRegistry` 的 SQL 都是标准 SQL，迁移工作量小
- 建议用 `postgres` 或 `pg` 包替换 `better-sqlite3`，接口相似
- 添加 `DATABASE_URL` env var

#### 6. SFO 机场接入 Registry
**现状**：SFO 仍使用 `buildSFOWorld()`（硬编码）。

**目标**：SFO 同样走 `GET /api/passengers?tenant=airchina_sfo`。

---

## 已知问题

### pax.html 中的 `PAX_DATA` 硬编码
位置：`public/pax.html` 约 668-689 行。
影响：未知旅客 ID 的 `plan` 默认为 `"free"`，不走 server registry 查询。
临时解法：通过 URL `?plan=premium` 参数覆盖。
根治方案：见 Phase 2 第 1 项。

### `outboundDep` 时间每次请求都重新计算
位置：`server/routes/passengers.ts` `enrichWithFlightTime()`，调用 `buildPekFlights()`。
影响：`buildPekFlights()` 基于 `Date.now() + depOffset * 60_000`，每次 GET 都返回新的时间，但偏移量一致，实际 ETA 计算不受影响。
根治方案：航班起飞时间存入数据库或 flight 服务单独管理。

### 10s 轮询在大量旅客时可能产生压力
位置：`useDashboard.ts` `setInterval(() => loadPassengers(), 10_000)`。
目前规模（<500 旅客/航班）无问题。
长期方案：WS 推送 `passenger_created` 事件替代轮询。

---

## 快速测试方法

### 1. 启动服务
```bash
cd apps/dashboard
cp .env.example .env  # 填入 JWT_SECRET 和 ADMIN_CREDENTIALS
npm run dev           # Vite dev server + Express (两端口: 5173 + 5175)
```

### 2. 验证 Registry 创建旅客
```bash
# 用旅客端访问（触发 WS hello → registry 创建记录）
open "http://localhost:5173/pax?pix=TX1&tenant=airchina&view=video"

# 用 admin 查看
curl -b "orienta_admin_token=<token>" \
  "http://localhost:5173/api/passengers?tenant=airchina" | jq .
```

### 3. 验证管理端 PATCH
```bash
curl -X PATCH -b "orienta_admin_token=<token>" \
  -H "Content-Type: application/json" \
  -d '{"extStatus":"red","activity":"shopping"}' \
  "http://localhost:5173/api/passengers/TX1?tenant=airchina"
```

### 4. 确认 SQLite 数据
```bash
sqlite3 data/passengers.db "SELECT id, name, flight_id, gate_id, is_online FROM passengers;"
```

---

## 文件结构速查

```
apps/dashboard/
├── public/
│   ├── pax.html          ← 旅客主页面（已修改 WS hello）
│   ├── pax-login.html    ← 旅客入口选择页
│   ├── pax-flight.html   ← 航班选择页
│   └── pax-route-video.html ← 室内导航/视频页
├── server/
│   ├── passengers/
│   │   └── PassengerRegistry.ts  ← SQLite 注册表（核心）
│   ├── routes/
│   │   ├── auth.ts               ← 新增 requireAdmin middleware
│   │   └── passengers.ts         ← REST API
│   ├── hub/
│   │   └── wsHub.ts              ← 注入 registry
│   ├── server.ts                 ← 实例化 registry
│   └── config.ts                 ← DB_PATH env var
├── src/
│   ├── sim/airports/
│   │   └── pek.ts                ← 新增 demoFlightsForPid()
│   ├── components/
│   │   └── PaxEntryWrapper.tsx   ← 注入 dep/arr 到 pax.html URL
│   ├── features/passengers/
│   │   └── useDashboard.ts       ← 从 API 加载旅客（非硬编码）
│   └── app/
│       └── Dashboard.tsx         ← 移除 buildPekWorld
└── data/
    └── passengers.db             ← SQLite（gitignore 此目录）
```

---

## .env 新增项

```bash
# 旅客注册表数据库路径（默认 ./data/passengers.db）
DB_PATH=./data/passengers.db
```

记得把 `data/` 加入 `.gitignore`。
