/**
 * Runtime application configuration.
 *
 * Change portal / web map / branding here (or override at runtime with
 * `window.APP_CONFIG`) to reuse this workbench for a different scenario.
 */

export const APP_CONFIG = {
  portalUrl: "https://dev.esribangladesh.com/portal",
  webmapId: "f5a07bf1c93346968dfdde7699ab43c8",
  /** Set a registered OAuth app id to enable IdentityManager. Leave blank for public web maps. */
  oauthAppId: "",
  title: "Insight Hub Dashboard",
  subtitle: "Bangladesh Administrative Intelligence",
  /** Optional kicker above the title; leave empty to hide. */
  orgLabel: "",
  defaultMetric: "Total_Incidents",
  defaultAnalyticsGroup: "Incident",
  rankingRows: 40,
  chartMaxIndicators: 10,
  arcgisVersion: "4.33",
} as const;

export type AppConfig = typeof APP_CONFIG;

declare global {
  interface Window {
    APP_CONFIG?: Partial<AppConfig>;
  }
}

export function getAppConfig(): AppConfig {
  if (typeof window === "undefined") return APP_CONFIG;
  return { ...APP_CONFIG, ...(window.APP_CONFIG ?? {}) } as AppConfig;
}
