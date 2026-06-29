/**
 * Runtime airport/tenant config loader (Multi-airport Model B).
 *
 * Reads data config from `config/airports/*.yaml` and `config/tenants/*.yaml`
 * at server startup and hydrates the shared registries. Adding a hub/airline is
 * dropping a validated YAML file + restarting the server — no rebuild, no code.
 *
 * Override the directory with AIRPORT_CONFIG_DIR (defaults to ./config relative
 * to the process working directory, matching DB_PATH conventions).
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { toAirportDefinition, tenantConfigSchema } from "../../src/config/airports/schema";
import { setAirports } from "../../src/config/airports/registry";
import { setTenants, type TenantDefinition } from "../../src/config/tenants/registry";
import type { AirportDefinition } from "../../src/config/airports/types";
import { logger } from "../lib/logger";

function configDir(): string {
  return process.env.AIRPORT_CONFIG_DIR || path.resolve(process.cwd(), "config");
}

function readYamlFiles(dir: string): unknown[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort()
    .map((f) => yaml.load(fs.readFileSync(path.join(dir, f), "utf8")));
}

export function loadRuntimeConfig(): {
  airports: AirportDefinition[];
  tenants: TenantDefinition[];
} {
  const base = configDir();
  const airports = readYamlFiles(path.join(base, "airports")).map(toAirportDefinition);
  const tenants = readYamlFiles(path.join(base, "tenants")).map(
    (r) => tenantConfigSchema.parse(r) as TenantDefinition,
  );
  return { airports, tenants };
}

/** Load config from disk and hydrate the shared registries. */
export function hydrateRegistriesFromDisk(opts?: {
  defaultAirport?: string;
  defaultTenant?: string;
}): void {
  const { airports, tenants } = loadRuntimeConfig();
  if (airports.length === 0) {
    logger.warn("airport_config_empty", { dir: configDir() });
  }
  setAirports(airports, { defaultId: opts?.defaultAirport });
  setTenants(tenants, { defaultId: opts?.defaultTenant });
  logger.info("airport_config_loaded", {
    dir: configDir(),
    airports: airports.map((a) => a.id),
    tenants: tenants.map((t) => t.id),
  });
}
