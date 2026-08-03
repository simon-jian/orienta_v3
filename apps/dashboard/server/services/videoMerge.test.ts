import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { hasValidDuration } from "./videoMerge";

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function tmpFile(name: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "orienta-videomerge-"));
  dirs.push(dir);
  return path.join(dir, name);
}

describe("hasValidDuration", () => {
  it("returns true for a real, playable video with a positive duration", async () => {
    const file = tmpFile("valid.mp4");
    // Generate a real 1-second test-pattern clip — exercises the actual
    // ffprobe binary/parsing path, not a mock.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=5",
      "-pix_fmt", "yuv420p", file,
    ]);
    expect(await hasValidDuration(file)).toBe(true);
  });

  it("returns false for a nonzero-size file that isn't a valid video (regression: size-only check)", async () => {
    const file = tmpFile("corrupt.mp4");
    // A plausible-looking but truncated/garbage "video" — this is exactly
    // the case a size-only readiness check would previously have marked
    // "ready" and served to a passenger.
    writeFileSync(file, Buffer.from("not actually an mp4 file".repeat(50)));
    expect(await hasValidDuration(file)).toBe(false);
  });

  it("returns false for an empty file", async () => {
    const file = tmpFile("empty.mp4");
    writeFileSync(file, Buffer.alloc(0));
    expect(await hasValidDuration(file)).toBe(false);
  });

  it("fails open (returns true) when ffprobe itself can't be found, rather than blocking every merge", async () => {
    const file = tmpFile("whatever.mp4");
    writeFileSync(file, Buffer.from("irrelevant"));
    const realPath = process.env.PATH;
    try {
      // No directory on PATH contains an "ffprobe" binary.
      process.env.PATH = "";
      expect(await hasValidDuration(file)).toBe(true);
    } finally {
      process.env.PATH = realPath;
    }
  });
});
