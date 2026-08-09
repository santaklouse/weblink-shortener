import { access } from "node:fs/promises";
import { Reader } from "@maxmind/geoip2-node";

const COUNTRY_CODE_PATTERN = /^(?:[A-Z]{2}|T1)$/;

export async function createGeoIpResolver(config, logger = console) {
  let reader = null;

  if (config.geoIpDatabasePath) {
    try {
      await access(config.geoIpDatabasePath);
      reader = await Reader.open(config.geoIpDatabasePath, { watchForUpdates: true });
      logger.log(`GeoIP database loaded from ${config.geoIpDatabasePath}`);
    } catch (error) {
      if (error?.code === "ENOENT") {
        logger.warn(
          `GeoIP database not found at ${config.geoIpDatabasePath}; country values require trusted Cloudflare headers or a local MMDB file.`,
        );
      } else {
        logger.warn(`GeoIP database could not be loaded from ${config.geoIpDatabasePath}`, error);
      }
    }
  }

  return {
    lookup(ipAddress, cloudflareCountry) {
      const headerCode = normalizeCountryCode(cloudflareCountry);
      if (config.trustCloudflareHeaders && headerCode) return headerCode;

      if (reader && ipAddress) {
        try {
          return normalizeCountryCode(reader.country(ipAddress)?.country?.isoCode) || "XX";
        } catch {
          return "XX";
        }
      }

      return "XX";
    },
  };
}

export function normalizeCountryCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return COUNTRY_CODE_PATTERN.test(code) ? code : null;
}
