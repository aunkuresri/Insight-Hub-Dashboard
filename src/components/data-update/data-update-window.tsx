import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ADMIN_LEVELS,
  applyCsvUpdates,
  type AdminLevelId,
  type CsvTable,
  type UpdateMode,
} from "@/lib/data-update/apply-csv-updates";
import {
  addFieldToLayers,
  type AddFieldResult,
} from "@/lib/data-update/add-layer-field";
import {
  type IndicatorField,
  type IndicatorGroup,
} from "@/config/indicators";
import { useAppStore } from "@/store/app-store";
import { useUiStore } from "@/store/ui-store";

/* PLACEHOLDER - full file will be replaced */
export function DataUpdateWindow() {
  return null;
}
