import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { INDICATOR_GROUPS, fieldsForGroups, labelForField } from "@/config/indicators";
import { ADMIN_LEVELS, type AdminLevelId } from "@/config/layers";
import { applyCsvUpdates, type UpdateMode } from "@/lib/data-update/apply-csv-updates";
import { parseCsvFile, type CsvTable } from "@/lib/data-update/csv";
import { useAppStore } from "@/store/app-store";
import { useUiStore } from "@/store/ui-store";

function formatUnknownError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message;
    if (typeof o.details === "string" && o.details.trim()) return o.details;
    if (Array.isArray(o.details) && o.details.length) {
      return o.details.map(String).join(" · ");
    }
  }
  return "Update failed. Check the CSV headers, field selection, and that the feature service allows editing.";
}

export function DataUpdateWindow() {
  const open = useUiStore((s) => s.dataUpdateWindowOpen);
  const setOpen = useUiStore((s) => s.setDataUpdateWindowOpen);
  const mapReady = useAppStore((s) => s.mapReady);
  const showToast = useAppStore((s) => s.showToast);
  const refreshAnalytics = useAppStore((s) => s.refreshAnalytics);

  const [levelId, setLevelId] = useState<AdminLevelId>("division");
  const [groupIds, setGroupIds] = useState<string[]>(
    INDICATOR_GROUPS[0] ? [INDICATOR_GROUPS[0].id] : [],
  );
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [mode, setMode] = useState<UpdateMode>("append");
  const [fileName, setFileName] = useState<string>("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableFields = useMemo(() => fieldsForGroups(groupIds), [groupIds]);

  const selectedFieldLabels = useMemo(
    () => fieldIds.map((id) => labelForField(id)),
    [fieldIds],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, setOpen, busy]);

  useEffect(() => {
    const allowed = new Set(availableFields.map((f) => f.id));
    setFieldIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [availableFields]);

  if (!open) return null;

  const toggleGroup = (id: string) => {
    setGroupIds((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const toggleField = (id: string) => {
    setFieldIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const removeField = (id: string) => {
    setFieldIds((prev) => prev.filter((x) => x !== id));
  };

  const onFile = async (file: File | null) => {
    setError(null);
    setResultMessage(null);
    setFileInfo(null);
    setTable(null);
    setFileName("");
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".txt")) {
      setError("Please upload a CSV file (export Excel as CSV).");
      return;
    }
    try {
      const parsed = await parseCsvFile(file);
      setTable(parsed);
      setFileName(file.name);
      setFileInfo(`${parsed.rows.length} row(s), ${parsed.headers.length} column(s).`);
    } catch (err) {
      setError(formatUnknownError(err));
    }
  };

  const run = async () => {
    if (!table) {
      setError("Attach a CSV file first.");
      setResultMessage(null);
      return;
    }
    if (!fieldIds.length) {
      setError("Select at least one indicator field.");
      setResultMessage(null);
      return;
    }
    if (!mapReady) {
      setError("Wait until the web map finishes loading before running an update.");
      setResultMessage(null);
      return;
    }

    setBusy(true);
    setError(null);
    setResultMessage(null);

    try {
      const result = await applyCsvUpdates({
        levelId,
        fieldIds,
        mode,
        table,
      });

      const msg =
        result.message ||
        `Update finished. Matched ${result.matched}, updated ${result.updated}, skipped ${result.skipped}.`;

      setResultMessage(msg);
      showToast({ kind: "success", message: msg });
      void refreshAnalytics();
    } catch (err) {
      const msg = formatUnknownError(err);
      setError(msg);
      setResultMessage(null);
      showToast({ kind: "danger", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const canRun = mapReady && !busy && Boolean(table) && fieldIds.length > 0;

  const node = (
    <div className="analytics-modal-root" role="presentation">
      <button
        type="button"
        className="analytics-modal-backdrop"
        aria-label="Close data update"
        onClick={() => {
          if (!busy) setOpen(false);
        }}
      />
      <div className="data-update-modal" role="dialog" aria-modal="true" aria-label="Data update">
        <header className="analytics-modal-header">
          <div className="panel-header-title">
            <calcite-icon icon="upload" scale="s" />
            <h2>Data update</h2>
          </div>
          <button
            type="button"
            className="panel-close-btn"
            aria-label="Close"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            <calcite-icon icon="x" scale="s" />
          </button>
        </header>

        {/* Scrollable form only — footer stays clear below */}
        <div className="data-update-body">
          <p className="section-hint" style={{ marginTop: 0 }}>
            Upload a CSV matching the feature layer schema. Select one or more indicator groups and
            fields, then choose Append or Append and Replace.
          </p>

          <section>
            <div className="section-head">
              <h2>Administrative level</h2>
            </div>
            <div className="chip-row wrap" role="group" aria-label="Administrative level">
              {ADMIN_LEVELS.map((level) => {
                const on = levelId === level.id;
                return (
                  <button
                    key={level.id}
                    type="button"
                    className={on ? "chip chip-active" : "chip"}
                    aria-pressed={on}
                    onClick={() => setLevelId(level.id)}
                  >
                    {level.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="section-head">
              <h2>Indicator groups</h2>
              <span className="method-tag">{groupIds.length} selected</span>
            </div>
            <div className="chip-row wrap" role="group" aria-label="Indicator groups">
              {INDICATOR_GROUPS.map((item) => {
                const on = groupIds.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={on ? "chip chip-active" : "chip"}
                    aria-pressed={on}
                    onClick={() => toggleGroup(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <p className="section-hint">Select one or more groups. Field picks are kept across groups.</p>
          </section>

          <section>
            <div className="section-head">
              <h2>Fields to update</h2>
              <span className="method-tag">{fieldIds.length} selected</span>
            </div>
            {availableFields.length ? (
              <ul className="check-list" role="listbox" aria-multiselectable="true">
                {availableFields.map((field) => {
                  const on = fieldIds.includes(field.id);
                  return (
                    <li key={field.id} role="option" aria-selected={on}>
                      <label className={`check-list-item${on ? " is-selected" : ""}`}>
                        <span className="check-list-box" aria-hidden="true">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleField(field.id)}
                          />
                          <span className="check-list-box-ui">
                            {on ? <calcite-icon icon="check" scale="s" /> : null}
                          </span>
                        </span>
                        <span className="check-list-item-label">{field.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="empty-note">Select at least one indicator group.</p>
            )}
          </section>

          <section>
            <div className="section-head">
              <h2>Selected fields</h2>
            </div>
            {fieldIds.length ? (
              <div className="selected-fields-box" role="list" aria-label="Selected fields">
                {fieldIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="selected-field-chip"
                    role="listitem"
                    title="Remove field"
                    onClick={() => removeField(id)}
                  >
                    <span>{labelForField(id)}</span>
                    <calcite-icon icon="x" scale="s" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-note">No fields selected yet.</p>
            )}
            {selectedFieldLabels.length > 0 ? (
              <p className="section-hint">
                {selectedFieldLabels.length} field{selectedFieldLabels.length === 1 ? "" : "s"}:{" "}
                {selectedFieldLabels.join(", ")}
              </p>
            ) : null}
          </section>

          <section>
            <div className="section-head">
              <h2>Update mode</h2>
            </div>
            <div className="seg">
              <button
                type="button"
                className={mode === "append" ? "seg-btn seg-active" : "seg-btn"}
                onClick={() => setMode("append")}
              >
                Append
              </button>
              <button
                type="button"
                className={mode === "append_replace" ? "seg-btn seg-active" : "seg-btn"}
                onClick={() => setMode("append_replace")}
              >
                Append and Replace
              </button>
            </div>
            <p className="section-hint">
              {mode === "append"
                ? "Adds CSV values to existing attribute values for the selected fields."
                : "Overwrites selected fields with CSV values (other fields unchanged)."}
            </p>
          </section>

          <section>
            <div className="section-head">
              <h2>CSV attachment</h2>
            </div>
            <label className="data-update-file">
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
              <span className="chip">{fileName || "Choose CSV file…"}</span>
            </label>
            {fileInfo ? <p className="section-hint">{fileInfo}</p> : null}
            {!mapReady ? (
              <p className="section-hint">Wait until the web map finishes loading before running an update.</p>
            ) : null}
          </section>
        </div>

        {/* Solid footer — never covered by scroll content */}
        <footer className="data-update-footer">
          <div className="data-update-result" aria-live="polite">
            {busy ? (
              <div className="data-update-banner data-update-banner--info" role="status">
                <strong>Running update…</strong>
                <span>Matching features and writing attributes. Please wait.</span>
              </div>
            ) : null}
            {!busy && resultMessage ? (
              <div className="data-update-banner data-update-banner--success" role="status">
                <strong>Update completed</strong>
                <span>{resultMessage}</span>
              </div>
            ) : null}
            {!busy && error ? (
              <div className="data-update-banner data-update-banner--danger" role="alert">
                <strong>Update failed</strong>
                <span>{error}</span>
              </div>
            ) : null}
          </div>

          <div className="data-update-actions">
            <button
              type="button"
              className="data-update-run-btn"
              disabled={!canRun}
              onClick={() => void run()}
            >
              {busy ? "Running…" : "Run update"}
            </button>
            <button
              type="button"
              className="data-update-cancel-btn"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
