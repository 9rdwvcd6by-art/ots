import { useEffect, useMemo, useState } from "react";
import { GLOBAL_ROLES, ROLE_EXPLANATIONS } from "../utils/roleLabels";
import { useRoleLabels } from "../hooks/useRoleLabels";

const THEME = {
  primary: "#A0522D", primaryDark: "#7A3A1E", primaryLight: "#F4E4D4",
  ink: "#2B1D14", inkMuted: "#4A3525", gray: "#8B7355",
  border: "#E8D9C4", bg: "#FAF3E7", card: "#FFFCF6", danger: "#B8442E",
  gold: "#C8A24A",
};

/* ================================================================== */
/*  Small hooks                                                        */
/* ================================================================== */
function useDebouncedValue(value, delay = 150) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/* ================================================================== */
/*  Role guide                                                         */
/* ================================================================== */
function RoleGuide({ roleLabelOf }) {
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 150);

  const rows = useMemo(
    () =>
      GLOBAL_ROLES.map((key) => ({
        key,
        label: roleLabelOf(key),
        explanation: ROLE_EXPLANATIONS?.[key] || "No description available for this role.",
      })),
    [roleLabelOf]
  );

  const visible = useMemo(() => {
    if (!debounced.trim()) return rows;
    const q = debounced.toLowerCase();
    return rows.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.explanation.toLowerCase().includes(q)
    );
  }, [rows, debounced]);

  const allOpen = visible.length > 0 && visible.every((r) => openKeys.has(r.key));

  const toggleOne = (key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setOpenKeys((prev) => {
      if (allOpen) return new Set();
      const next = new Set(prev);
      visible.forEach((r) => next.add(r.key));
      return next;
    });
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h4 style={{ margin: "0 0 4px", fontSize: 14, color: THEME.ink }}>
            What each role can do
          </h4>
          <p style={{ margin: 0, fontSize: 12, color: THEME.gray }}>
            A quick reference for the whole team. {visible.length} of {rows.length} roles.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Search roles…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "6px 10px", fontSize: 13, minWidth: 160,
              border: `1px solid ${THEME.border}`, borderRadius: 6,
              background: THEME.card, color: THEME.ink,
            }}
          />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={toggleAll}
            disabled={visible.length === 0}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        {visible.length === 0 && (
          <div className="empty-state" style={{ padding: 12, fontSize: 13 }}>
            No roles match "{debounced}".
          </div>
        )}

        {visible.map((r) => {
          const open = openKeys.has(r.key);
          return (
            <div
              key={r.key}
              style={{
                border: `1px solid ${THEME.border}`,
                borderRadius: 8,
                background: open ? THEME.primaryLight : THEME.card,
                transition: "background 150ms ease",
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => toggleOne(r.key)}
                aria-expanded={open}
                aria-controls={`role-desc-${r.key}`}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "10px 12px", background: "transparent", border: "none",
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace", fontSize: 11,
                    padding: "2px 6px", borderRadius: 4,
                    background: THEME.card, border: `1px solid ${THEME.border}`,
                    color: THEME.gray,
                  }}
                >
                  {r.key}
                </span>
                <span style={{ flex: 1, fontWeight: 600, color: THEME.ink, fontSize: 13 }}>
                  {r.label}
                </span>
                <span
                  aria-hidden
                  style={{
                    fontSize: 12, color: THEME.gray,
                    transform: open ? "rotate(90deg)" : "rotate(0deg)",
                    transition: "transform 150ms ease",
                  }}
                >
                  ▸
                </span>
              </button>
              {open && (
                <div
                  id={`role-desc-${r.key}`}
                  style={{
                    padding: "0 12px 12px 12px",
                    fontSize: 13, lineHeight: 1.5, color: THEME.inkMuted,
                  }}
                >
                  {r.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Main component                                                     */
/* ================================================================== */
export default function RoleLabelsSettings({ push }) {
  const { label: roleLabelOf, labels, defaults, saveLabels, loading } = useRoleLabels();
  const [draft, setDraft] = useState(labels || {});
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    setDraft(labels || {});
  }, [labels]);

  /* Default label resolver — tolerates hooks that only expose `label()` */
  const defaultLabelOf = (key) => {
    const fromDefaults = defaults?.[key];
    if (typeof fromDefaults === "string" && fromDefaults.trim()) return fromDefaults;
    // Fallback: prefer the shipped default via ROLE_EXPLANATIONS-adjacent lookup
    return key;
  };

  const dirty = useMemo(
    () =>
      GLOBAL_ROLES.some(
        (r) => (draft[r] || "").trim() !== (labels?.[r] || "").trim()
      ),
    [draft, labels]
  );

  /* Warn before leaving with unsaved changes */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /* Detect duplicate labels (warning only) */
  const duplicateLabels = useMemo(() => {
    const map = new Map();
    GLOBAL_ROLES.forEach((r) => {
      const text = (draft[r] || "").trim();
      if (!text) return;
      if (!map.has(text)) map.set(text, []);
      map.get(text).push(r);
    });
    const dupes = [];
    map.forEach((keys, label) => {
      if (keys.length > 1) dupes.push({ label, keys });
    });
    return dupes;
  }, [draft]);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveLabels(draft);
      push?.("Role labels saved", "success");
      setAnnouncement("Role labels saved.");
    } catch (err) {
      push?.("Failed to save role labels: " + err.message, "error");
      setAnnouncement("Failed to save role labels.");
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setDraft(labels || {});
    setAnnouncement("Changes discarded.");
  };

  const resetField = (key) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const copyKey = async (key) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      /* clipboard may be blocked */
    }
  };

  if (loading) {
    return <div style={{ fontSize: 13, color: THEME.gray }}>Loading role labels…</div>;
  }

  return (
    <div className="card">
      <div className="card-header-row">
        <h3 style={{ margin: 0 }}>Role Labels</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!dirty && !saving && (
            <span style={{ fontSize: 12, color: THEME.gray }}>No changes</span>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onReset}
            disabled={!dirty || saving}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <p style={{ fontSize: 13, color: THEME.gray, marginTop: 0 }}>
        Customize how each role is displayed across the app. The role key itself is
        fixed — only the label changes. Leave a field blank to fall back to the
        default label.
      </p>

      {/* Duplicate warning */}
      {duplicateLabels.length > 0 && (
        <div
          role="alert"
          style={{
            background: "#FBEBC7", color: "#7A4A0E", padding: "10px 14px",
            borderRadius: 8, fontSize: 12, marginBottom: 12, lineHeight: 1.5,
          }}
        >
          ⚠ These labels are used for more than one role:{" "}
          {duplicateLabels.map((d, i) => (
            <span key={d.label}>
              <b>{d.label}</b>
              {" "}({d.keys.join(", ")}){i < duplicateLabels.length - 1 ? "; " : ""}
            </span>
          ))}
          . Consider making them unique so users aren't confused.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {GLOBAL_ROLES.map((key) => {
          const current = draft[key] ?? "";
          const saved = labels?.[key] ?? "";
          const defaultLabel = defaultLabelOf(key);
          const isCustomized = current.trim() !== "" && current.trim() !== defaultLabel.trim();
          const fieldChanged = (current || "").trim() !== (saved || "").trim();
          const nearLimit = current.length > 20;

          return (
            <div key={key} className="form-group" style={{ margin: 0 }}>
              <label
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 12, color: THEME.gray, marginBottom: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => copyKey(key)}
                  title="Copy role key"
                  style={{
                    fontFamily: "monospace", fontSize: 11,
                    padding: "1px 6px", borderRadius: 4,
                    background: THEME.primaryLight, color: THEME.primaryDark,
                    border: "none", cursor: "pointer",
                  }}
                >
                  {copiedKey === key ? "copied ✓" : key}
                </button>
                {isCustomized && (
                  <span
                    style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 999,
                      background: THEME.primaryLight, color: THEME.primaryDark,
                      fontWeight: 600,
                    }}
                  >
                    customized
                  </span>
                )}
                {fieldChanged && (
                  <span
                    style={{
                      fontSize: 10, padding: "1px 6px", borderRadius: 999,
                      background: "#FBEBC7", color: "#7A4A0E",
                      fontWeight: 600,
                    }}
                  >
                    unsaved
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {fieldChanged && (
                  <button
                    type="button"
                    onClick={() => resetField(key)}
                    aria-label={`Reset label for ${key}`}
                    title="Reset this label"
                    style={{
                      background: "transparent", border: "none",
                      cursor: "pointer", color: THEME.gray, fontSize: 14,
                      padding: 0, lineHeight: 1,
                    }}
                  >
                    ↺
                  </button>
                )}
              </label>

              <input
                value={current}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={defaultLabel || key}
                maxLength={40}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderColor: fieldChanged ? THEME.primary : THEME.border,
                }}
              />

              <div
                style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 10, color: nearLimit ? THEME.danger : THEME.gray,
                  marginTop: 2,
                }}
              >
                <span>
                  {isCustomized ? `Default: ${defaultLabel}` : "Using default"}
                </span>
                <span>{current.length}/40</span>
              </div>
            </div>
          );
        })}
      </div>

      <RoleGuide roleLabelOf={roleLabelOf} />

      {/* Screen-reader announcements */}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}