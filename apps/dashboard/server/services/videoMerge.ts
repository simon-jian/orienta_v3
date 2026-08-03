/**
 * PEK merged-video job service (P2-4).
 *
 * Moves the CPU-heavy ffmpeg concat off the web event loop:
 *  - With Redis: enqueue a job, then poll (non-blocking I/O) until the separate
 *    Python worker (scripts/pek_video_worker.py) writes the output to the shared
 *    volume. The web process never spawns ffmpeg.
 *  - Without Redis: spawn the concat script as a NON-blocking child process
 *    (replacing the old spawnSync, which froze the event loop for up to 120s) and
 *    await its exit. Identical concurrent requests share one in-flight job.
 *
 * Either way the HTTP contract is unchanged: callers get { url, cached, bytes }.
 */
import { spawn } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PEK_VIDEO_CONCAT_SCRIPT, PEK_CSV_PATH, ROUTE_SITE_DIR, DIST_DIR } from "../paths";
import { VIDEO_OUTPUT_DIR } from "../config";
import { getRedisCmd } from "../redis/redisClient";
import { logger } from "../lib/logger";

export type MergeSpec =
  | { mode: "index"; fromIdx: number; toIdx: number }
  | { mode: "gate"; from: string; to: string };

export type MergeResult = { url: string; cached: boolean; bytes: number };

const QUEUE_KEY = "orienta:video:jobs";
const STATUS_PREFIX = "orienta:video:status:";
const JOB_TIMEOUT_MS = 120_000;
const POLL_MS = 500;
const STATUS_TTL_S = 600;

export function mergeOutName(spec: MergeSpec): string {
  return spec.mode === "index"
    ? `PEK_gate_timestamp_merged_idx_${spec.fromIdx}_to_${spec.toIdx}.mp4`
    : `PEK_gate_timestamp_merged_${spec.from}_to_${spec.to}.mp4`;
}

/** Output dir: explicit override (shared volume) → built dist → in-repo public. */
export function mergeOutDir(): string {
  if (VIDEO_OUTPUT_DIR) return VIDEO_OUTPUT_DIR;
  const distRouteSite = path.join(DIST_DIR, "route_site");
  return existsSync(distRouteSite)
    ? path.join(distRouteSite, "dynamic")
    : path.join(ROUTE_SITE_DIR, "dynamic");
}

function selectorArgs(spec: MergeSpec): string[] {
  return spec.mode === "index"
    ? ["--from-index", String(spec.fromIdx), "--to-index", String(spec.toIdx)]
    : ["--from-gate", spec.from, "--to-gate", spec.to];
}

function readyResult(outPath: string, outName: string): MergeResult | null {
  if (!existsSync(outPath)) return null;
  const st = statSync(outPath);
  if (!st.isFile() || st.size <= 0) return null;
  return { url: `/route_site/dynamic/${outName}`, cached: true, bytes: st.size };
}

const inflight = new Map<string, Promise<MergeResult>>();

export async function requestMerge(spec: MergeSpec): Promise<MergeResult> {
  const outName = mergeOutName(spec);
  const outDir = mergeOutDir();
  const outPath = path.join(outDir, outName);
  // Defense in depth: routes/flight.ts whitelists gate tokens to [A-Z0-9]{1,8}
  // before they reach here, but never trust a path built from request input
  // without also verifying the result didn't escape the intended directory.
  const resolvedOutDir = path.resolve(outDir);
  const resolvedOutPath = path.resolve(outPath);
  if (resolvedOutPath !== resolvedOutDir && !resolvedOutPath.startsWith(resolvedOutDir + path.sep)) {
    throw new Error("merge_output_path_escaped_output_dir");
  }
  mkdirSync(outDir, { recursive: true });

  const cached = readyResult(outPath, outName);
  if (cached) return cached;

  const redis = getRedisCmd();
  return redis
    ? enqueueAndWait(redis, spec, outName, outPath)
    : runLocal(spec, outName, outPath);
}

// ── Redis-backed path: a separate worker container does the ffmpeg work ─────────

async function enqueueAndWait(
  redis: NonNullable<ReturnType<typeof getRedisCmd>>,
  spec: MergeSpec,
  outName: string,
  outPath: string,
): Promise<MergeResult> {
  const statusKey = STATUS_PREFIX + outName;
  // Enqueue once: SET NX guards against duplicate jobs for the same output.
  const claimed = await redis.set(statusKey, "queued", "EX", STATUS_TTL_S, "NX");
  if (claimed === "OK") {
    await redis.rpush(QUEUE_KEY, JSON.stringify({ outName, spec }));
    logger.info("video_job_enqueued", { outName });
  }

  const deadline = Date.now() + JOB_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready = readyResult(outPath, outName);
    if (ready) return { ...ready, cached: false };
    const status = await redis.get(statusKey);
    if (status && status.startsWith("failed")) {
      await redis.del(statusKey); // allow a later retry
      throw new Error(status.slice("failed:".length) || "merge_failed");
    }
    await sleep(POLL_MS);
  }
  // Clear the status key on our own timeout too — otherwise it sits at
  // "queued" for the rest of its STATUS_TTL_S (10 min), blocking retries for
  // this exact clip even if the worker eventually finishes or a client retries.
  await redis.del(statusKey).catch(() => { /* best effort */ });
  throw new Error("merge_timeout");
}

// ── In-process path: non-blocking spawn (single machine) ────────────────────────

function runLocal(spec: MergeSpec, outName: string, outPath: string): Promise<MergeResult> {
  const existing = inflight.get(outName);
  if (existing) return existing;

  const job = spawnConcat(spec, outPath)
    .then(() => {
      const ready = readyResult(outPath, outName);
      if (!ready) throw new Error("merge_produced_no_output");
      return { ...ready, cached: false };
    })
    .finally(() => inflight.delete(outName));

  inflight.set(outName, job);
  return job;
}

function spawnConcat(spec: MergeSpec, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      PEK_VIDEO_CONCAT_SCRIPT,
      "--csv", PEK_CSV_PATH,
      "--src-dir", ROUTE_SITE_DIR,
      "--out", outPath,
      ...selectorArgs(spec),
    ];
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout?.on("data", () => { /* drain */ });
    child.stderr?.on("data", (d) => { stderr += String(d); });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("merge_timeout"));
    }, JOB_TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`merge_failed: ${stderr.slice(-800)}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
