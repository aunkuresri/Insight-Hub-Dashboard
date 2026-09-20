import { useEffect, useRef } from "react";
import { createMapController, clearMapController, getMapController } from "@/lib/gis/map-controller";
import { useAppStore } from "@/store/app-store";
import { useUiStore } from "@/store/ui-store";

/** Relabel map UI panel toggles after controller creates them (layout v2). */
function relabelPanelToggles() {
  const host = document.querySelector(".map-stage");
  if (!host) return;
  host.querySelectorAll(".esri-ui-top-left .map-esri-panel-btn").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.title = "Smart Symbology";
    el.setAttribute("aria-label", "Smart Symbology");
    el.querySelector("calcite-icon")?.setAttribute("icon", "classify-pixels");
  });
  host.querySelectorAll(".esri-ui-top-right .map-esri-panel-btn").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    el.title = "Legends";
    el.setAttribute("aria-label", "Legends");
    el.querySelector("calcite-icon")?.setAttribute("icon", "legend");
  });
}

function resizeMapView() {
  const map = getMapController() as { view?: { resize?: () => void } } | null;
  map?.view?.resize?.();
}

export function MapPane() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const setMapReady = useAppStore((s) => s.setMapReady);
  const setMapError = useAppStore((s) => s.setMapError);
  const setScale = useAppStore((s) => s.setScale);
  const refreshAnalytics = useAppStore((s) => s.refreshAnalytics);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const analyticsOpen = useUiStore((s) => s.analyticsWindowOpen);
  const analyticsDocked = useUiStore((s) => s.analyticsDocked);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    (async () => {
      try {
        await createMapController(host, {
          onReady: () => {
            if (!cancelled) {
              setMapReady(true);
              const map = getMapController();
              map?.setPanelToggleVisibility({
                left: !useAppStore.getState().leftOpen,
                right: !useAppStore.getState().rightOpen,
              });
              window.setTimeout(() => relabelPanelToggles(), 0);
              window.setTimeout(() => resizeMapView(), 50);
            }
          },
          onScale: (level, scale) => {
            if (!cancelled) setScale(level, scale);
          },
          onExtentSettled: () => {
            if (!cancelled) void refreshAnalytics();
          },
          onError: (message) => {
            if (!cancelled) setMapError(message);
          },
          onOpenLeftPanel: () => useAppStore.getState().setLeftOpen(true),
          onOpenRightPanel: () => useAppStore.getState().setRightOpen(true),
        });
      } catch (err) {
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : "The web map could not be loaded.");
        }
      }
    })();

    return () => {
      cancelled = true;
      clearMapController();
      setMapReady(false);
    };
  }, [setMapError, setMapReady, setScale, refreshAnalytics]);

  useEffect(() => {
    getMapController()?.setPanelToggleVisibility({
      left: !leftOpen,
      right: !rightOpen,
    });
    relabelPanelToggles();
    window.setTimeout(() => resizeMapView(), 80);
  }, [leftOpen, rightOpen]);

  // Re-layout map when analytics split / dock toggles
  useEffect(() => {
    window.setTimeout(() => resizeMapView(), 80);
  }, [analyticsOpen, analyticsDocked]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resizeMapView());
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return <div ref={hostRef} className="map-host" aria-label="Administrative web map" />;
}
