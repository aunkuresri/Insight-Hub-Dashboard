import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  INDICATOR_GROUPS,
  labelForField,
  type IndicatorField,
  type IndicatorGroup,
} from "@/config/indicators";
import { ADMIN_LEVELS, type AdminLevelId } from "@/config/layers";
import { applyCsvUpdates, type UpdateMode } from "@/lib/data-update/apply-csv-updates";
import { addFieldToWebMapLayers } from "@/lib/data-update/add-layer-field";
import { parseCsvFile, type CsvTable } from "@/lib/data-update/csv";
import { useAppStore } from "@/store/app-store";
import { useUiStore } from "@/store/ui-store";

type MainTab = "add" | "modify";
type ModifyTab = "add_field" | "modify_field" | "modify_group";

const CATALOG_KEY = "insight-hub-indicator-catalog-v1";

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

function loadCatalog(): IndicatorGroup[] {
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    if (!raw) return INDICATOR_GROUPS.map((g) => ({ ...g, fields: [...g.fields] }));
    const parsed = JSON.parse(raw) as IndicatorGroup[];
    if (!Array.isArray(parsed) || !parsed.length) {
      return INDICATOR_GROUPS.map((g) => ({ ...g, fields: [...g.fields] }));
    }
    return parsed;
  } catch {
    return INDICATOR_GROUPS.map((g) => ({ ...g, fields: [...g.fields] }));
  }
}

function saveCatalog(groups: IndicatorGroup[]) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify(groups));
  } catch {
    /* ignore */
  }
  try {
    INDICATOR_GROUPS.length = 0;
    for (const g of groups) INDICATOR_GROUPS.push(g);
  } catch {
    /* may be frozen */
  }
}

export function DataUpdateWindow() {
  const open = useUiStore((s) => s.dataUpdateWindowOpen);
  const setOpen = useUiStore((s) => s.setDataUpdateWindowOpen);
  const mapReady = useAppStore((s) => s.mapReady);
  const showToast = useAppStore((s) => s.showToast);
  const refreshAnalytics = useAppStore((s) => s.refreshAnalytics);

  const [mainTab, setMainTab] = useState<MainTab>("add");
  const [modifyTab, setModifyTab] = useState<ModifyTab>("add_field");
  const [catalog, setCatalog] = useState<IndicatorGroup[]>(() =>
    typeof window !== "undefined" ? loadCatalog() : INDICATOR_GROUPS,
  );

  const [levelId, setLevelId] = useState<AdminLevelId>("union");
  const [browseGroupId, setBrowseGroupId] = useState<string>(INDICATOR_GROUPS[0]?.id ?? "");
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [mode, setMode] = useState<UpdateMode>("append");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<CsvTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileInfo, setFileInfo] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [editGroupId, setEditGroupId] = useState<string>(catalog[0]?.id ?? "");

  const [addFieldName, setAddFieldName] = useState("");
  const [addFieldLabel, setAddFieldLabel] = useState("");
  const [addFieldGroupId, setAddFieldGroupId] = useState(catalog[0]?.id ?? "");
  const [addFieldType, setAddFieldType] = useState("Double");

  const browseGroup = catalog.find((g) => g.id === browseGroupId) ?? catalog[0];
  const browseFields = browseGroup?.fields ?? [];

  const selectedFieldLabels = useMemo(
    () => fieldIds.map((id) => labelForField(id)),
    [fieldIds],
  );

  useEffect(() => {
    if (!open) return;
    setCatalog(loadCatalog());
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

  if (!open) return null;

  const persistCatalog = (next: IndicatorGroup[]) => {
    setCatalog(next);
    saveCatalog(next);
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

  const runAddData = async () => {
    if (!table) {
      setError("Attach a CSV file first.");
      return;
    }
    if (!fieldIds.length) {
      setError("Select at least one indicator field.");
      return;
    }
    if (!mapReady) {
      setError("Wait until the web map finishes loading before running an update.");
      return;
    }
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const result = await applyCsvUpdates({ levelId, fieldIds, mode, table });
      const msg =
        result.message ||
        `Update finished. Matched ${result.matched}, updated ${result.updated}, skipped ${result.skipped}.`;
      setResultMessage(msg);
      showToast({ kind: "success", message: msg });
      void refreshAnalytics();
    } catch (err) {
      const msg = formatUnknownError(err);
      setError(msg);
      showToast({ kind: "danger", message: msg });
    } finally {
      setBusy(false);
    }
  };

  const canRunAdd = mapReady && !busy && Boolean(table) && fieldIds.length > 0;

  const createGroup = () => {
    const id = newGroupId.trim() || newGroupLabel.trim().replace(/\s+/g, "_");
    const label = newGroupLabel.trim() || id;
    if (!id) {
      setError("Enter a group id or label.");
      return;
    }
    if (catalog.some((g) => g.id.toLowerCase() === id.toLowerCase())) {
      setError(`Group "${id}" already exists.`);
      return;
    }
    const next = [...catalog, { id, label, description: "", fields: [] as IndicatorField[] }];
    persistCatalog(next);
    setNewGroupId("");
    setNewGroupLabel("");
    setEditGroupId(id);
    setError(null);
    setResultMessage(`Indicator group "${label}" created.`);
  };

  const removeGroup = (id: string) => {
    if (catalog.length <= 1) {
      setError("Keep at least one indicator group.");
      return;
    }
    const next = catalog.filter((g) => g.id !== id);
    persistCatalog(next);
    if (editGroupId === id) setEditGroupId(next[0]?.id ?? "");
    setResultMessage(`Removed group "${id}".`);
    setError(null);
  };

  const addFieldToGroup = async () => {
    const fid = addFieldName.trim().replace(/\s+/g, "_");
    const flabel = (addFieldLabel.trim() || fid).trim();
    const gid = addFieldGroupId || editGroupId || catalog[0]?.id;
    if (!fid || !gid) {
      setError("Field name and target group are required.");
      return;
    }
    if (!mapReady) {
      setError("Wait until the web map finishes loading before adding a field.");
      return;
    }
    setBusy(true);
    setError(null);
    setResultMessage(null);
    try {
      const service = await addFieldToWebMapLayers({
        name: fid,
        alias: flabel || fid,
        type: addFieldType,
      });
      const next = catalog.map((g) => {
        if (g.id !== gid) return g;
        if (g.fields.some((f) => f.id.toLowerCase() === fid.toLowerCase())) return g;
        return { ...g, fields: [...g.fields, { id: fid, label: flabel || fid }] };
      });
      persistCatalog(next);
      setAddFieldName("");
      setAddFieldLabel("");
      if (service.failed.length && !service.created && !service.skipped) {
        setError(service.message);
      } else {
        setResultMessage(
          `Catalog: "${flabel}" in group "${gid}". Service: ${service.message}`,
        );
      }
    } catch (err) {
      setError(formatUnknownError(err));
    } finally {
      setBusy(false);
    }
  };

  const moveField = (fieldId: string, fromGroup: string, toGroup: string) => {
    if (fromGroup === toGroup) return;
    let moved: IndicatorField | null = null;
    const next = catalog.map((g) => {
      if (g.id === fromGroup) {
        const f = g.fields.find((x) => x.id === fieldId);
        if (f) moved = f;
        return { ...g, fields: g.fields.filter((x) => x.id !== fieldId) };
      }
      return g;
    });
    if (!moved) return;
    const final = next.map((g) => {
      if (g.id !== toGroup) return g;
      if (g.fields.some((f) => f.id === fieldId)) return g;
      return { ...g, fields: [...g.fields, moved!] };
    });
    persistCatalog(final);
    setResultMessage(`Moved "${fieldId}" to "${toGroup}".`);
  };

  const removeFieldFromGroup = (groupId: string, fieldId: string) => {
    const next = catalog.map((g) =>
      g.id === groupId ? { ...g, fields: g.fields.filter((f) => f.id !== fieldId) } : g,
    );
    persistCatalog(next);
    setResultMessage(`Removed "${fieldId}" from "${groupId}".`);
  };

  const node = (
    <div className="analytics-modal-root" role="presentation">
      <button
        type="button"
        className="analytics-modal-backdrop"
        aria-label="Close manage data"
        onClick={() => {
          if (!busy) setOpen(false);
        }}
      />
      <div className="data-update-modal" role="dialog" aria-modal="true" aria-label="Manage Data">
        <header className="analytics-modal-header">
          <div className="panel-header-title">
            <calcite-icon icon="table" scale="s" />
            <h2>Manage Data</h2>
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

        <div className="data-update-body">
          <div className="data-update-maintabs" role="tablist" aria-label="Manage Data sections">
            <button
              type="button"
              className={mainTab === "add" ? "seg-btn seg-active" : "seg-btn"}
              role="tab"
              aria-selected={mainTab === "add"}
              onClick={() => setMainTab("add")}
            >
              <calcite-icon icon="upload" scale="s" />
              Add Data
            </button>
            <button
              type="button"
              className={mainTab === "modify" ? "seg-btn seg-active" : "seg-btn"}
              role="tab"
              aria-selected={mainTab === "modify"}
              onClick={() => setMainTab("modify")}
            >
              <calcite-icon icon="pencil" scale="s" />
              Modify Data
            </button>
          </div>

          {mainTab === "add" ? (
            <>
              <p className="section-hint" style={{ marginTop: 0 }}>
                Load attribute values from a CSV. Select indicator fields like Smart Symbology (one
                group at a time). Join uses the administrative name field for the chosen level.
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
                  <h2>Indicator group</h2>
                </div>
                <div className="chip-row wrap" role="group" aria-label="Indicator group">
                  {catalog.map((item) => {
                    const on = browseGroupId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={on ? "chip chip-active" : "chip"}
                        aria-pressed={on}
                        onClick={() => setBrowseGroupId(item.id)}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <div className="section-head">
                  <h2>Fields in group</h2>
                  <span className="method-tag">{fieldIds.length} selected</span>
                </div>
                {browseFields.length ? (
                  <ul className="check-list" role="listbox" aria-multiselectable="true">
                    {browseFields.map((field) => {
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
                  <p className="empty-note">No fields in this group. Use Modify Data to add fields.</p>
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
                    {selectedFieldLabels.length} field
                    {selectedFieldLabels.length === 1 ? "" : "s"}: {selectedFieldLabels.join(", ")}
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
                    Replace
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
              </section>
            </>
          ) : (
            <>
              <div className="data-update-subtabs" role="tablist" aria-label="Modify Data sections">
                <button
                  type="button"
                  className={modifyTab === "add_field" ? "seg-btn seg-active" : "seg-btn"}
                  role="tab"
                  aria-selected={modifyTab === "add_field"}
                  onClick={() => setModifyTab("add_field")}
                >
                  <calcite-icon icon="plus" scale="s" />
                  Add Field
                </button>
                <button
                  type="button"
                  className={modifyTab === "modify_field" ? "seg-btn seg-active" : "seg-btn"}
                  role="tab"
                  aria-selected={modifyTab === "modify_field"}
                  onClick={() => setModifyTab("modify_field")}
                >
                  <calcite-icon icon="pencil" scale="s" />
                  Modify Field
                </button>
                <button
                  type="button"
                  className={modifyTab === "modify_group" ? "seg-btn seg-active" : "seg-btn"}
                  role="tab"
                  aria-selected={modifyTab === "modify_group"}
                  onClick={() => setModifyTab("modify_group")}
                >
                  <calcite-icon icon="layer-service" scale="s" />
                  Create Group
                </button>
              </div>

              {modifyTab === "add_field" ? (
                <section className="data-update-card">
                  <div className="section-head">
                    <h2>Add field</h2>
                  </div>
                  <p className="section-hint" style={{ marginTop: 0 }}>
                    Creates the attribute column on all Boundary and Chart layers in the web map, and
                    registers it in the dashboard catalog. Requires edit privileges on the hosted
                    feature service. Then load values via Add Data.
                  </p>
                  <div className="data-update-form-grid">
                    <label className="data-update-field">
                      <span className="data-update-field-label">Field name</span>
                      <input
                        className="data-update-input"
                        value={addFieldName}
                        onChange={(e) => setAddFieldName(e.target.value)}
                        placeholder="e.g. crime_rate"
                        autoComplete="off"
                      />
                    </label>
                    <label className="data-update-field">
                      <span className="data-update-field-label">Display label</span>
                      <input
                        className="data-update-input"
                        value={addFieldLabel}
                        onChange={(e) => setAddFieldLabel(e.target.value)}
                        placeholder="e.g. Crime Rate"
                        autoComplete="off"
                      />
                    </label>
                    <label className="data-update-field">
                      <span className="data-update-field-label">Field type</span>
                      <select
                        className="data-update-input"
                        value={addFieldType}
                        onChange={(e) => setAddFieldType(e.target.value)}
                      >
                        <option value="Double">Double (number)</option>
                        <option value="Integer">Integer</option>
                        <option value="String">String</option>
                      </select>
                    </label>
                    <label className="data-update-field">
                      <span className="data-update-field-label">Indicator group</span>
                      <select
                        className="data-update-input"
                        value={addFieldGroupId}
                        onChange={(e) => setAddFieldGroupId(e.target.value)}
                      >
                        {catalog.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="data-update-form-actions">
                    <button
                      type="button"
                      className="data-update-run-btn"
                      disabled={busy || !addFieldName.trim()}
                      onClick={() => void addFieldToGroup()}
                    >
                      {busy ? "Adding…" : "Add field to layers"}
                    </button>
                  </div>
                </section>
              ) : null}

              {modifyTab === "modify_field" ? (
                <section className="data-update-card data-update-card--flat">
                  <p className="section-hint" style={{ marginTop: 0 }}>
                    Move or remove fields between indicator groups. Changes apply to the dashboard
                    catalog (Smart Symbology and analytics).
                  </p>
                  {catalog.map((g) => (
                    <div key={g.id} className="data-update-group-block">
                      <div className="section-head">
                        <h2>{g.label}</h2>
                        <span className="method-tag">{g.fields.length}</span>
                      </div>
                      {g.fields.length ? (
                        <ul className="data-update-field-list" role="list">
                          {g.fields.map((f) => (
                            <li key={f.id} className="data-update-field-row" role="listitem">
                              <span className="data-update-field-row-label">{f.label}</span>
                              <select
                                className="data-update-input data-update-input--sm"
                                value={g.id}
                                aria-label={`Move ${f.label} to group`}
                                onChange={(e) => moveField(f.id, g.id, e.target.value)}
                              >
                                {catalog.map((tg) => (
                                  <option key={tg.id} value={tg.id}>
                                    {tg.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="data-update-icon-btn"
                                title={`Remove ${f.label}`}
                                aria-label={`Remove ${f.label}`}
                                onClick={() => removeFieldFromGroup(g.id, f.id)}
                              >
                                <calcite-icon icon="trash" scale="s" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="empty-note">No fields in this group.</p>
                      )}
                    </div>
                  ))}
                </section>
              ) : null}

              {modifyTab === "modify_group" ? (
                <section className="data-update-card">
                  <div className="section-head">
                    <h2>Create group</h2>
                  </div>
                  <p className="section-hint" style={{ marginTop: 0 }}>
                    Add or remove indicator groups used by Smart Symbology and analytics.
                  </p>
                  <div className="data-update-form-grid">
                    <label className="data-update-field">
                      <span className="data-update-field-label">Group id</span>
                      <input
                        className="data-update-input"
                        value={newGroupId}
                        onChange={(e) => setNewGroupId(e.target.value)}
                        placeholder="e.g. health"
                        autoComplete="off"
                      />
                    </label>
                    <label className="data-update-field">
                      <span className="data-update-field-label">Display label</span>
                      <input
                        className="data-update-input"
                        value={newGroupLabel}
                        onChange={(e) => setNewGroupLabel(e.target.value)}
                        placeholder="e.g. Health"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  <div className="data-update-form-actions">
                    <button type="button" className="data-update-run-btn" onClick={createGroup}>
                      Create group
                    </button>
                  </div>

                  <div className="section-head" style={{ marginTop: "1rem" }}>
                    <h2>Existing groups</h2>
                    <span className="method-tag">{catalog.length}</span>
                  </div>
                  <ul className="data-update-group-list" role="list">
                    {catalog.map((g) => (
                      <li key={g.id} className="data-update-group-item" role="listitem">
                        <div className="data-update-group-item-main">
                          <span className="data-update-group-item-label">{g.label}</span>
                          <span
                            className="method-tag data-update-group-count"
                            aria-label={`${g.fields.length} fields`}
                          >
                            {`${g.fields.length} field${g.fields.length === 1 ? "" : "s"}`}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="data-update-icon-btn"
                          title={`Remove group ${g.label}`}
                          aria-label={`Remove group ${g.label}`}
                          onClick={() => removeGroup(g.id)}
                        >
                          <calcite-icon icon="trash" scale="s" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </div>

        <footer className="data-update-footer">
          <div className="data-update-result" aria-live="polite">
            {busy ? (
              <div className="data-update-banner data-update-banner--info" role="status">
                <strong>Running…</strong>
                <span>Matching features and writing attributes. Please wait.</span>
              </div>
            ) : null}
            {!busy && resultMessage ? (
              <div className="data-update-banner data-update-banner--success" role="status">
                <strong>Completed</strong>
                <span>{resultMessage}</span>
              </div>
            ) : null}
            {!busy && error ? (
              <div className="data-update-banner data-update-banner--danger" role="alert">
                <strong>Error</strong>
                <span>{error}</span>
              </div>
            ) : null}
          </div>
          <div className="data-update-actions">
            {mainTab === "add" ? (
              <button
                type="button"
                className="data-update-run-btn"
                disabled={!canRunAdd}
                onClick={() => void runAddData()}
              >
                {busy ? "Running…" : "Run Add Data"}
              </button>
            ) : null}
            <button
              type="button"
              className="data-update-cancel-btn"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
