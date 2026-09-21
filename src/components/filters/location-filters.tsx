import { useEffect, useRef, useState } from "react";
import { ADMIN_LEVELS, type AdminLevelId } from "@/config/layers";
import { useAppStore } from "@/store/app-store";

type LocationFiltersProps = {
  /** header = landscape dropdowns in top bar; panel = classic vertical stack */
  variant?: "header" | "panel";
};

export function LocationFilters({ variant = "panel" }: LocationFiltersProps) {
  const filters = useAppStore((s) => s.filters);
  const options = useAppStore((s) => s.filterOptions);
  const setFilter = useAppStore((s) => s.setFilter);
  const clearFilters = useAppStore((s) => s.clearFilters);
  const mapReady = useAppStore((s) => s.mapReady);
  const [openId, setOpenId] = useState<AdminLevelId | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openId) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      setOpenId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId]);

  const hasFilter = filters ? Object.values(filters).some(Boolean) : false;

  const selectValue = (levelId: AdminLevelId, name: string | null) => {
    void setFilter?.(levelId, name);
    setOpenId(null);
  };

  if (variant === "header") {
    return (
      <div className="header-filters" role="group" aria-label="Location filters" ref={rootRef}>
        {ADMIN_LEVELS.map((level) => {
          const parentReady = !level.parentId || Boolean(filters?.[level.parentId]);
          const disabled = !mapReady || !parentReady;
          const value = filters?.[level.id] ?? "";
          const list = options?.[level.id] ?? [];
          const isOpen = openId === level.id;
          const isActive = Boolean(value);
          const allLabel =
            level.id === "division"
              ? "All divisions"
              : parentReady
                ? `All ${level.label.toLowerCase()}s`
                : `Select ${ADMIN_LEVELS.find((l) => l.id === level.parentId)?.label ?? "parent"} first`;

          return (
            <div
              key={level.id}
              className={`header-filter-dd${isOpen ? " is-open" : ""}${isActive ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
            >
              <button
                type="button"
                className="header-filter-trigger"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  if (disabled) return;
                  setOpenId(isOpen ? null : level.id);
                }}
              >
                <span className="header-filter-label">{level.shortLabel}</span>
                <span className="header-filter-value">{value || allLabel}</span>
                <calcite-icon icon={isOpen ? "chevron-up" : "chevron-down"} scale="s" />
              </button>
              {isOpen && !disabled ? (
                <ul className="header-filter-menu" role="listbox">
                  <li role="option">
                    <button
                      type="button"
                      className={!value ? "is-selected" : undefined}
                      onClick={() => selectValue(level.id as AdminLevelId, null)}
                    >
                      {allLabel}
                    </button>
                  </li>
                  {list.map((name) => (
                    <li key={name} role="option">
                      <button
                        type="button"
                        className={value === name ? "is-selected" : undefined}
                        onClick={() => selectValue(level.id as AdminLevelId, name)}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        {hasFilter ? (
          <button
            type="button"
            className="header-filter-clear"
            aria-label="Clear filters"
            title="Clear filters"
            onClick={(e) => {
              e.stopPropagation();
              void clearFilters?.();
              setOpenId(null);
            }}
          >
            <calcite-icon icon="erase" scale="s" />
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="filter-stack">
      {ADMIN_LEVELS.map((level) => {
        const parentReady = !level.parentId || Boolean(filters?.[level.parentId]);
        const disabled = !mapReady || !parentReady;
        const value = filters?.[level.id] ?? "";
        const list = options?.[level.id] ?? [];
        return (
          <label key={level.id} className="field">
            <span className="field-label-bold">{level.label}</span>
            <select
              value={value}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value || null;
                void setFilter?.(level.id as AdminLevelId, next);
              }}
            >
              <option value="">
                {level.id === "division"
                  ? "All divisions"
                  : parentReady
                    ? `All ${level.label.toLowerCase()}s`
                    : `Select ${ADMIN_LEVELS.find((l) => l.id === level.parentId)?.label ?? "parent"} first`}
              </option>
              {list.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {hasFilter ? (
        <div className="clear-row">
          <button
            type="button"
            className="header-filter-clear"
            aria-label="Clear filters"
            title="Clear filters"
            onClick={() => void clearFilters?.()}
          >
            <calcite-icon icon="erase" scale="s" />
            Clear filters
          </button>
        </div>
      ) : null}
    </section>
  );
}
