import { useEffect, useRef } from "react";
import { getAppConfig } from "@/config/app-config";
import { ADMIN_LEVELS, scaleToLevel, type LocationFilters } from "@/config/layers";
import { whereForLevel } from "@/lib/gis/where";
import { getMapController } from "@/lib/gis/map-controller";
import { useAppStore } from "@/store/app-store";

type PreviewView = {
  destroy: () => void;
  goTo: (t: unknown, o?: unknown) => Promise<unknown>;
  when: () => Promise<void>;
  resize?: () => void;
  extent: unknown;
  scale: number;
  map?: unknown;
  container?: HTMLDivElement | string | null;
  watch: (prop: string, cb: (v: unknown) => void) => { remove: () => void };
  on: (event: string, cb: (e: unknown) => void) => { remove: () => void };
  hitTest: (e: unknown) => Promise<{
    results: Array<{
      graphic?: { attributes?: Record<string, unknown>; geometry?: unknown; layer?: unknown };
      layer?: { title?: string; type?: string };
    }>;
  }>;
  popup: {
    open: (opts: unknown) => void;
    close: () => void;
    autoOpenEnabled?: boolean;
  };
  ui: {
    add: (w: unknown, pos?: string) => void;
    remove: (w: unknown) => void;
  };
  viewpoint: { clone: () => unknown };
  whenLayerView?: (layer: unknown) => Promise<{ highlight: (g: unknown) => { remove: () => void } }>;
};

// MEDIUM_TEST - partial file intentionally truncated for size test
export function AnalyticsMapPreview() {
  return <div>test</div>;
}
