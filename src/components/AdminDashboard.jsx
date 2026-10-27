import { useEffect, useState, useMemo, useCallback } from "react";
import {
  collection, onSnapshot, doc, updateDoc, deleteDoc, setDoc, addDoc,
  serverTimestamp, query, where, orderBy, getDoc,
} from "firebase/firestore";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import Papa from "papaparse";
import { db, auth, getSecondaryAuth } from "../firebase";
import { buildOvertimeReportPDF } from "../utils/pdfReport";
import { changeUserPassword, sendResetEmail } from "../utils/adminApi";
import { useOrg } from "../context/OrgContext";
import { useRoleLabels } from "../hooks/useRoleLabels";
import {
  GLOBAL_ROLES, ADMIN_ROLES, assignableRoles, resolveRoleExplanation,
} from "../utils/roleLabels";
import {
  STATUS_LABELS, STATUS_BADGE,
  ALL_PENDING, ALL_APPROVED,
  isInternalStatus,
} from "../utils/statusLabels";
import SubAdminRegister from "./SubAdminRegister";
import RoleLabelsSettings from "./RoleLabelsSettings";

const ROLE_OPTIONS = GLOBAL_ROLES.filter((r) => r !== "superAdmin");
const REQUESTOR_PENDING = ["pending_verifier", "pending_confirmer", "pending_initial_approver"];
const INTERNAL_PENDING = ["pending_initial_approver_internal", "pending_final_approver_internal"];

const THEME = {
  primary: "#A0522D", primaryDark: "#7A3A1E", primaryLight: "#F4E4D4",
  ink: "#2B1D14", inkMuted: "#4A3525", gray: "#8B7355",
  border: "#E8D9C4", bg: "#FAF3E7", card: "#FFFCF6", danger: "#B8442E",
  gold: "#C8A24A",
};

function shiftHours(s, e) {
  if (!s || !e) return 0;
  const [sh, sm] = s.split(":").map(Number);
  const [eh, em] = e.split(":").map(Number);
  let a = sh * 60 + sm, b = eh * 60 + em;
  if (b < a) b += 24 * 60;
  return (b - a) / 60;
}
function fmtHours(h) {
  if (!h) return "0h";
  const wh = Math.floor(h), m = Math.round((h - wh) * 60);
  return m === 0 ? `${wh}h` : `${wh}h ${m}m`;
}
function normalizeEmail(e) { return (e || "").trim().toLowerCase(); }
function projectLabel(p) {
  if (!p) return "—";
  return `${p.code ? `[${p.code}] ` : ""}${p.name || p.id}`;
}
function isInternalRequest(r) { return r?.isInternal === true || isInternalStatus(r?.status); }
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || ""); }

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = "info", ttl = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);
  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, remove };
}
function useIsMobile(breakpoint = 768) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < breakpoint);
  useEffect(() => {
    const on = () => setM(window.innerWidth < breakpoint);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [breakpoint]);
  return m;
}
function useDebouncedValue(value, delay = 200) {
  const [d, setD] = useState(value);
  useEffect(() => { const t = setTimeout(() => setD(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return d;
}
function useEscapeKey(handler, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e) => { if (e.key === "Escape") handler(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [handler, active]);
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", top: 16, right: 16, left: 16, maxWidth: 360, marginLeft: "auto", zIndex: 2000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map((t) => (
        <div key={t.id} role="status" onClick={() => onDismiss(t.id)}
          style={{ pointerEvents: "auto", cursor: "pointer", padding: "10px 14px", borderRadius: 8,
            color: "#fff", fontSize: 13, boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
            background: t.kind === "error" ? THEME.danger : t.kind === "success" ? THEME.primaryDark : THEME.ink }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
function Modal({ title, onClose, children, isMobile, footer }) {
  useEscapeKey(onClose);
  return (
    <div role="dialog" aria-modal="true"
      style={{ position: "fixed", inset: 0, background: "rgba(43,29,20,0.55)",
        display: "flex", alignItems: isMobile ? "flex-end" : "center",
        justifyContent: "center", zIndex: 1800, padding: isMobile ? 0 : 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: THEME.card, borderRadius: isMobile ? "16px 16px 0 0" : 10,
        width: "100%", maxWidth: isMobile ? "100%" : 560,
        maxHeight: isMobile ? "90dvh" : "85dvh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 12px 32px rgba(43,29,20,0.25)" }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${THEME.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: THEME.ink }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: "transparent", border: "none", fontSize: 20, color: THEME.gray, cursor: "pointer" }}>✕</button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
function ConfirmDialog({ title = "Please confirm", message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel, isMobile }) {
  return (
    <Modal title={title} onClose={onCancel} isMobile={isMobile}
      footer={
        <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? "btn btn-danger" : "btn btn-primary"} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      }>
      <div style={{ padding: 18, fontSize: 14, color: THEME.inkMuted }}>{message}</div>
    </Modal>
  );
}

function RolePickerModal({ user, isSelf, adminCount, onSave, onClose, isMobile, isSubAdmin, roleLabelOf }) {
  const availableRoles = useMemo(() => assignableRoles(isSubAdmin ? "subAdmin" : "admin"), [isSubAdmin]);
  const [selected, setSelected] = useState(user.role || "");
  const [saving, setSaving] = useState(false);

  const willDemoteSelf = isSelf && ADMIN_ROLES.includes(user.role) && !ADMIN_ROLES.includes(selected);
  const willDemoteLastAdmin = !isSubAdmin && ADMIN_ROLES.includes(user.role) && !ADMIN_ROLES.includes(selected) && adminCount <= 1;
  const blockReason = willDemoteLastAdmin ? "This is the only admin in the organization. Promote another user to admin first." : null;
  const disabled = saving || !!blockReason || selected === user.role;

  const submit = async () => {
    if (disabled) return;
    if (willDemoteSelf) { if (!window.confirm("You are about to remove your own admin privileges. Continue?")) return; }
    setSaving(true);
    try { await onSave(selected); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Change Role — ${user.name || user.email}`} onClose={onClose} isMobile={isMobile}
      footer={
        <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: THEME.gray }}>Current: <b style={{ color: THEME.ink }}>{roleLabelOf(user.role)}</b></span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={disabled}>{saving ? "Saving…" : "Save role"}</button>
          </div>
        </div>
      }>
      <div style={{ padding: "14px 18px", overflowY: "auto", flex: 1 }}>
        {blockReason && <div style={{ background: "#FBEBC7", color: "#7A4A0E", padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12 }}>⚠ {blockReason}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {availableRoles.map((r) => {
            const isSelected = selected === r;
            const desc = resolveRoleExplanation(r);
            return (
              <button key={r} type="button" onClick={() => setSelected(r)}
                style={{ textAlign: "left", padding: "10px 12px", borderRadius: 8,
                  border: `1.5px solid ${isSelected ? THEME.primary : THEME.border}`,
                  background: isSelected ? THEME.primaryLight : "transparent", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 16, height: 16, borderRadius: "50%",
                    border: `2px solid ${isSelected ? THEME.primary : THEME.border}`,
                    background: isSelected ? THEME.primary : "transparent",
                    display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {isSelected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
                  </span>
                  <span style={{ fontWeight: 600, color: THEME.ink, fontSize: 13 }}>{roleLabelOf(r)}</span>
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: THEME.gray, padding: "1px 6px", background: THEME.bg, borderRadius: 4 }}>{r}</span>
                </div>
                {desc && <div style={{ marginTop: 4, marginLeft: 24, fontSize: 12, color: THEME.gray, lineHeight: 1.4 }}>{desc}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

function Sidebar({ active, onNavigate, counts, collapsed, onToggle, isMobile, mobileOpen, onCloseMobile, onLogout, orgName, roleLabel }) {
  const items = useMemo(() => ([
    { id: "overview", label: "Overview", icon: "📊", count: null },
    { id: "users", label: "Users", icon: "👥", count: counts.users },
    { id: "projects", label: "Projects", icon: "🏗️", count: counts.projects },
    { id: "requests", label: "Requests", icon: "📋", count: counts.requests },
    { id: "settings", label: "Settings", icon: "⚙️", count: null },
  ]), [counts.users, counts.projects, counts.requests]);
  const width = isMobile ? 260 : collapsed ? 68 : 240;
  const style = isMobile
    ? { position: "fixed", top: 0, left: 0, bottom: 0, width, background: THEME.ink, color: "#f0e3d0",
        display: "flex", flexDirection: "column", zIndex: 1500,
        transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
        transition: "transform 200ms ease", boxShadow: mobileOpen ? "4px 0 24px rgba(0,0,0,0.4)" : "none" }
    : { width, transition: "width 180ms ease", background: THEME.ink, color: "#f0e3d0",
        display: "flex", flexDirection: "column", height: "100vh", flexShrink: 0 };

  return (
    <aside style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", minHeight: 60 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: THEME.primary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>OT</div>
        {(!collapsed || isMobile) && (
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{orgName || "Admin Panel"}</div>
            <div style={{ fontSize: 10, color: "#8b7a65" }}>{roleLabel}</div>
          </div>
        )}
        {isMobile && <button type="button" onClick={onCloseMobile} aria-label="Close" style={{ background: "transparent", border: "none", color: "#c9b49b", fontSize: 20 }}>✕</button>}
      </div>
      <nav style={{ flex: 1, padding: "10px 8px", overflowY: "auto" }}>
        {items.map((it) => {
          const a = active === it.id;
          return (
            <button key={it.id} type="button"
              onClick={() => { onNavigate(it.id); if (isMobile) onCloseMobile(); }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 6, border: "none",
                background: a ? "rgba(160,82,45,0.35)" : "transparent",
                color: a ? "#fff" : "#d8c8b4", cursor: "pointer", fontSize: 14, textAlign: "left", marginBottom: 2 }}>
              <span style={{ fontSize: 16 }}>{it.icon}</span>
              {(!collapsed || isMobile) && (
                <><span style={{ flex: 1 }}>{it.label}</span>
                  {it.count != null && (
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: a ? THEME.primary : "rgba(255,255,255,0.1)", color: "#fff" }}>{it.count}</span>
                  )}
                </>
              )}
            </button>
          );
        })}
      </nav>
      <div style={{ padding: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {!isMobile && (
          <>
            <div style={{ fontSize: 11, color: "#8b7a65", marginBottom: 4 }}>Signed in as</div>
            {!collapsed && (
              <div style={{ fontSize: 11, color: "#c9b49b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 8 }} title={auth.currentUser?.email || ""}>{auth.currentUser?.email || "—"}</div>
            )}
          </>
        )}
        <button type="button" onClick={onLogout}
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6,
            border: "1px solid rgba(220,38,38,0.35)", background: "rgba(220,38,38,0.1)",
            color: "#fca5a5", cursor: "pointer", fontSize: 12, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 8,
            justifyContent: collapsed && !isMobile ? "center" : "flex-start" }}>
          <span>⎋</span>{(!collapsed || isMobile) && <span>Sign Out</span>}
        </button>
        {!isMobile && (
          <button type="button" onClick={onToggle}
            style={{ padding: "6px 10px", width: "100%", borderRadius: 6, marginTop: 8,
              border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
              color: "#d8c8b4", cursor: "pointer", fontSize: 12,
              display: "flex", alignItems: "center", gap: 8,
              justifyContent: collapsed ? "center" : "flex-start" }}>
            <span>{collapsed ? "»" : "«"}</span>{!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </aside>
  );
}

export default function AdminDashboard() {
  const { organizationId, organization, role } = useOrg();
  const { label: roleLabelOf } = useRoleLabels();
  const isSubAdmin = role === "subAdmin";
  const [page, setPage] = useState("users");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [requests, setRequests] = useState([]);
  const [scopeIds, setScopeIds] = useState([]);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const { toasts, push, remove } = useToasts();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        const snap = await getDoc(doc(db, "users", uid));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : {};
        const scope = Array.isArray(data.scopedProjectIds) ? data.scopedProjectIds : [];
        setScopeIds(scope);
      } finally { if (!cancelled) setProfileLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    const q = query(collection(db, "users"), where("organizationId", "==", organizationId));
    return onSnapshot(q, (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [organizationId]);
  useEffect(() => {
    if (!organizationId) return;
    const q = query(collection(db, "projects"), where("organizationId", "==", organizationId), orderBy("name"));
    return onSnapshot(q, (snap) => setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [organizationId]);
  useEffect(() => {
    if (!organizationId) return;
    const q = query(collection(db, "overtime_requests"), where("organizationId", "==", organizationId));
    return onSnapshot(q, (snap) => setRequests(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [organizationId]);

  useEffect(() => {
    if (!isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = prev; };
  }, [isMobile, mobileOpen]);

  const scopeSet = useMemo(() => new Set(scopeIds), [scopeIds]);
  const visibleProjects = useMemo(() => !isSubAdmin ? projects : projects.filter((p) => scopeSet.has(p.id)), [projects, isSubAdmin, scopeSet]);
  const visibleRequests = useMemo(() => !isSubAdmin ? requests : requests.filter((r) => scopeSet.has(r.projectId || r.projectName)), [requests, isSubAdmin, scopeSet]);
  const visibleUsers = useMemo(() => {
    if (!isSubAdmin) return users;
    const myUid = auth.currentUser?.uid;
    return users.filter((u) => {
      if (u.id === myUid) return true;
      const ids = Array.isArray(u.projectIds) ? u.projectIds : [];
      if (ids.some((pid) => scopeSet.has(pid))) return true;
      const scoped = Array.isArray(u.scopedProjectIds) ? u.scopedProjectIds : [];
      return scoped.some((pid) => scopeSet.has(pid));
    });
  }, [users, isSubAdmin, scopeSet]);

  const stats = useMemo(() => ({
    totalUsers: visibleUsers.length,
    totalProjects: visibleProjects.length,
    totalRequests: visibleRequests.length,
    pending: visibleRequests.filter((r) => ALL_PENDING.includes(r.status)).length,
    pendingRequestor: visibleRequests.filter((r) => REQUESTOR_PENDING.includes(r.status)).length,
    pendingInternal: visibleRequests.filter((r) => INTERNAL_PENDING.includes(r.status)).length,
    approved: visibleRequests.filter((r) => ALL_APPROVED.includes(r.status)).length,
    approvedRequestor: visibleRequests.filter((r) => r.status === "approved").length,
    approvedInternal: visibleRequests.filter((r) => r.status === "approved_final_approver").length,
    totalApprovedHours: visibleRequests
      .filter((r) => ALL_APPROVED.includes(r.status))
      .reduce((s, r) => s + shiftHours(r.startTime, r.endTime), 0),
  }), [visibleUsers, visibleProjects, visibleRequests]);

  const handleLogout = useCallback(async () => {
    if (!window.confirm("Sign out?")) return;
    try { await signOut(auth); }
    catch (err) { push("Sign out failed: " + err.message, "error"); }
  }, [push]);

  const titles = useMemo(() => ({ overview: "Overview", users: "Users", projects: "Projects", requests: "Requests", settings: "Settings" }), []);

  if (!profileLoaded) {
    return (
      <div style={{ display: "flex", height: "100dvh", alignItems: "center", justifyContent: "center", background: THEME.bg }}>
        <div style={{ fontSize: 14, color: THEME.gray }}>Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100dvh", width: "100vw", overflow: "hidden", background: THEME.bg, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <ToastStack toasts={toasts} onDismiss={remove} />

      {isMobile && mobileOpen && (
        <div onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1400 }} />
      )}

      <Sidebar
        active={page}
        onNavigate={setPage}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        counts={{ users: stats.totalUsers, projects: stats.totalProjects, requests: stats.totalRequests }}
        isMobile={isMobile}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={handleLogout}
        orgName={organization?.name}
        roleLabel={roleLabelOf(role)}
      />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100dvh" }}>
        {isMobile && (
          <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: THEME.card, borderBottom: `1px solid ${THEME.border}`, minHeight: 56, flexShrink: 0 }}>
            <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu"
              style={{ background: "transparent", border: "none", fontSize: 22, color: THEME.ink, cursor: "pointer" }}>☰</button>
            <div style={{ fontWeight: 600, color: THEME.ink }}>{titles[page]}</div>
          </header>
        )}

        <main style={{ flex: 1, overflowY: "auto", padding: isMobile ? 12 : 24, WebkitOverflowScrolling: "touch" }}>
          {page === "overview" && <Overview stats={stats} isSubAdmin={isSubAdmin} />}
          {page === "users" && (
            <UsersTab
              users={visibleUsers}
              projects={visibleProjects}
              organizationId={organizationId}
              push={push}
              isMobile={isMobile}
              isSubAdmin={isSubAdmin}
              roleLabelOf={roleLabelOf}
            />
          )}
          {page === "projects" && (
            <ProjectsTab
              projects={visibleProjects}
              users={visibleUsers}
              requests={visibleRequests}
              organizationId={organizationId}
              push={push}
              isMobile={isMobile}
              isSubAdmin={isSubAdmin}
            />
          )}
          {page === "requests" && (
            <RequestsTab
              requests={visibleRequests}
              users={visibleUsers}
              push={push}
              isMobile={isMobile}
              isSubAdmin={isSubAdmin}
              organizationName={organization?.name || ""}
            />
          )}
          {page === "settings" && (
            isSubAdmin ? (
              <div className="card">
                <h3>Settings</h3>
                <p style={{ fontSize: 13, color: THEME.gray }}>Only organization admins can change settings.</p>
              </div>
            ) : <RoleLabelsSettings push={push} />
          )}
        </main>
      </div>
    </div>
  );
}

function Overview({ stats, isSubAdmin }) {
  return (
    <>
      <h2 style={{ marginTop: 0, marginBottom: 16, color: THEME.ink }}>{isSubAdmin ? "Scoped Overview" : "Admin Overview"}</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>{isSubAdmin ? "Your scope" : "Company snapshot"}</h3>
        <div className="stats-grid">
          <Stat label="Users" value={stats.totalUsers} />
          <Stat label="Projects" value={stats.totalProjects} />
          <Stat label="All Requests" value={stats.totalRequests} />
          <Stat label="Pending (all)" value={stats.pending} />
          <Stat label="Approved (all)" value={stats.approved} />
          <Stat label="Approved Hours" value={fmtHours(stats.totalApprovedHours)} />
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Split by flow</h3>
        <div className="stats-grid">
          <Stat label="Requestor Pending" value={stats.pendingRequestor} />
          <Stat label="Internal Pending" value={stats.pendingInternal} />
          <Stat label="Requestor Approved" value={stats.approvedRequestor} />
          <Stat label="Internal Approved" value={stats.approvedInternal} />
        </div>
      </div>
    </>
  );
}
function Stat({ label, value }) { return (<div className="stat-box"><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>); }

function AssignProjectsModal({ user, projects, onClose, onSave, saving, isMobile }) {
  const initial = useMemo(() => (Array.isArray(user.projectIds) ? user.projectIds : []), [user.projectIds]);
  const [selected, setSelected] = useState(() => new Set(initial));
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 150);
  const visible = useMemo(() => {
    if (!debounced) return projects;
    const q = debounced.toLowerCase();
    return projects.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.code || "").toLowerCase().includes(q) || (p.location || "").toLowerCase().includes(q));
  }, [projects, debounced]);
  const toggle = useCallback((id) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  return (
    <Modal title={`Assign Projects — ${user.name || user.email}`} onClose={onClose} isMobile={isMobile}>
      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${THEME.border}` }}>
        <input placeholder="Search by name, code or location" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", marginBottom: 8, padding: 10, boxSizing: "border-box", border: `1px solid ${THEME.border}`, borderRadius: 6 }} />
        <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelected((s) => { const n = new Set(s); visible.forEach((p) => n.add(p.id)); return n; })}>Select all ({visible.length})</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
          <span style={{ marginLeft: "auto", color: THEME.gray }}>{selected.size} selected</span>
        </div>
      </div>
      <div style={{ padding: "10px 18px", overflowY: "auto", flex: 1 }}>
        {visible.length === 0 && <div className="empty-state" style={{ padding: 12 }}>No projects match.</div>}
        {visible.map((p) => {
          const checked = selected.has(p.id);
          return (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px", borderBottom: `1px solid ${THEME.border}`, cursor: "pointer" }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(p.id)} />
              <span style={{ flex: 1 }}><b>{p.code || "—"}</b> · {p.name}{p.location && <span style={{ marginLeft: 8, fontSize: 12, color: THEME.gray }}>({p.location})</span>}</span>
            </label>
          );
        })}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={() => onSave(Array.from(selected))}>{saving ? "Saving…" : "Save Assignments"}</button>
      </div>
    </Modal>
  );
}

function ChangePasswordModal({ user, push, onClose, isMobile }) {
  const [mode, setMode] = useState("set");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cloudUnavailable, setCloudUnavailable] = useState(false);
  const targetEmail = user?.email || "";
  const targetName = user?.name || targetEmail || user?.id;
  const canSubmit = mode === "email" ? !!targetEmail : password.length >= 6 && password === confirm;

  const handleSetPassword = async () => {
    if (password.length < 6) return push("Password must be at least 6 characters.", "error");
    if (password !== confirm) return push("Passwords do not match.", "error");
    setSaving(true);
    try { await changeUserPassword(user.id, password); push(`Password updated for ${targetName}.`, "success"); onClose(); }
    catch (err) {
      const code = err?.code || ""; const msg = err?.message || "";
      if (["functions/not-found","functions/unavailable","functions/internal"].includes(code) || msg.includes("unavailable")) {
        setCloudUnavailable(true); push("Direct change unavailable. Use reset email.", "error", 6500); setMode("email");
      } else if (code === "functions/permission-denied") push("Permission denied.", "error");
      else if (code === "functions/invalid-argument") push(msg || "Invalid password.", "error");
      else push("Failed to update password: " + msg, "error");
    } finally { setSaving(false); }
  };
  const handleSendReset = async () => {
    if (!targetEmail) return push("No email on file.", "error");
    setSaving(true);
    try { await sendResetEmail(targetEmail); push(`Reset email sent to ${targetEmail}.`, "success"); onClose(); }
    catch (err) { push("Failed to send reset email: " + err.message, "error"); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Change Password — ${targetName}`} onClose={onClose} isMobile={isMobile}>
      <div style={{ padding: 18 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 16, padding: 4, background: THEME.primaryLight, borderRadius: 8 }}>
          <button type="button" onClick={() => setMode("set")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "none",
              background: mode === "set" ? THEME.primary : "transparent",
              color: mode === "set" ? "#fff" : THEME.inkMuted, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Set password</button>
          <button type="button" onClick={() => setMode("email")}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: "none",
              background: mode === "email" ? THEME.primary : "transparent",
              color: mode === "email" ? "#fff" : THEME.inkMuted, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Send reset</button>
        </div>
        {mode === "set" && (
          <>
            {cloudUnavailable && <div style={{ padding: 10, background: "#FBEBC7", color: "#7A4A0E", borderRadius: 8, fontSize: 12, marginBottom: 12 }}>Direct change unavailable — user must reset via email.</div>}
            <div className="form-group">
              <label>New Password</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input type={show ? "text" : "password"} minLength={6} value={password}
                  onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters"
                  style={{ flex: 1, minWidth: 0, padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6 }} autoFocus />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
              </div>
              <PasswordStrength password={password} />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input type={show ? "text" : "password"} minLength={6} value={confirm}
                onChange={(e) => setConfirm(e.target.value)} placeholder="Re-type password"
                style={{ width: "100%", padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, boxSizing: "border-box" }} />
              {confirm && password !== confirm && <div style={{ fontSize: 12, color: THEME.danger, marginTop: 4 }}>Passwords do not match.</div>}
            </div>
          </>
        )}
        {mode === "email" && (
          <p style={{ fontSize: 13, color: THEME.inkMuted, marginTop: 0 }}>Reset link will be sent to <b>{targetEmail || "—"}</b>.</p>
        )}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        {mode === "set"
          ? <button type="button" className="btn btn-primary" onClick={handleSetPassword} disabled={saving || !canSubmit}>{saving ? "Saving…" : "Set Password"}</button>
          : <button type="button" className="btn btn-primary" onClick={handleSendReset} disabled={saving || !targetEmail}>{saving ? "Sending…" : "Send Reset Email"}</button>}
      </div>
    </Modal>
  );
}

function UsersTab({ users, projects, organizationId, push, isMobile, isSubAdmin, roleLabelOf }) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [roleFilter, setRoleFilter] = useState("all");
  const [savingId, setSavingId] = useState(null);
  const [assigningUser, setAssigningUser] = useState(null);
  const [passwordUser, setPasswordUser] = useState(null);
  const [roleUser, setRoleUser] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [regForm, setRegForm] = useState({ name: "", email: "", password: "", role: "requestor", projectIds: [] });
  const [showSubAdminForm, setShowSubAdminForm] = useState(false);

  const currentUid = auth.currentUser?.uid;
  const adminCount = useMemo(() => users.filter((u) => ADMIN_ROLES.includes(u.role)).length, [users]);
  const allowedRoleOptions = useMemo(() => assignableRoles(isSubAdmin ? "subAdmin" : "admin"), [isSubAdmin]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return users.filter((u) => {
      const matchSearch = !q || (u.name || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q);
      const matchRole = roleFilter === "all" || u.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [users, debouncedSearch, roleFilter]);

  const emailExists = useCallback((email, ignoreUid) => users.some((u) => u.id !== ignoreUid && normalizeEmail(u.email) === normalizeEmail(email)), [users]);

  const updateUser = useCallback(async (uid, patch) => {
    if (uid === currentUid && patch.role && !ADMIN_ROLES.includes(patch.role)) {
      if (!window.confirm("Removing your own admin privileges. Continue?")) return;
    }
    setSavingId(uid);
    try { await updateDoc(doc(db, "users", uid), patch); push("User updated", "success"); setEditingUserId(null); }
    catch (err) { push("Failed to update user: " + err.message, "error"); }
    finally { setSavingId(null); }
  }, [currentUid, push]);

  const changeRole = useCallback(async (uid, nextRole) => {
    setSavingId(uid);
    try { await updateDoc(doc(db, "users", uid), { role: nextRole }); push(`Role updated to ${roleLabelOf(nextRole)}.`, "success"); setRoleUser(null); }
    catch (err) { push("Failed to update role: " + err.message, "error"); }
    finally { setSavingId(null); }
  }, [push, roleLabelOf]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { id, email } = deleteTarget;
    setDeleteTarget(null);
    try { await deleteDoc(doc(db, "users", id)); push("User profile deleted", "success"); }
    catch (err) { push("Failed to delete user: " + err.message, "error"); }
  }, [deleteTarget, push]);
  const removeUser = useCallback((uid, email) => {
    if (uid === currentUid) return push("You cannot delete your own profile.", "error");
    setDeleteTarget({ id: uid, email });
  }, [currentUid, push]);
  const saveProjectAssignments = useCallback(async (uid, projectIds) => {
    setSavingId(uid);
    try { await updateDoc(doc(db, "users", uid), { projectIds }); push("Assignments saved", "success"); setAssigningUser(null); }
    catch (err) { push("Failed to save assignments: " + err.message, "error"); }
    finally { setSavingId(null); }
  }, [push]);

  const startRegister = useCallback(() => {
    setRegForm({ name: "", email: "", password: "", role: "requestor", projectIds: [] });
    setShowPassword(false); setShowRegister(true);
  }, []);
  const cancelRegister = useCallback(() => {
    setShowRegister(false); setRegForm({ name: "", email: "", password: "", role: "requestor", projectIds: [] });
  }, []);

  const registerUser = async (e) => {
    e.preventDefault();
    const name = regForm.name.trim(), email = normalizeEmail(regForm.email), password = regForm.password;
    if (!name) return push("Full name required.", "error");
    if (!isValidEmail(email)) return push("Valid email required.", "error");
    if (password.length < 6) return push("Password must be 6+ characters.", "error");
    if (emailExists(email)) return push("Email already exists in this organization.", "error");
    if (isSubAdmin && ADMIN_ROLES.includes(regForm.role)) return push("Sub-admins cannot create admin accounts.", "error");
    setRegistering(true);
    try {
      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const newUid = cred.user.uid;
      try { await signOut(secondaryAuth); } catch {}
      await setDoc(doc(db, "users", newUid), {
        name, displayName: name, email, role: regForm.role,
        organizationId, projectIds: regForm.projectIds || [],
        createdAt: serverTimestamp(), createdBy: currentUid || null,
      });
      push(`User "${name}" registered.`, "success"); cancelRegister();
    } catch (err) {
      const code = err.code || ""; let msg = err.message;
      if (code === "auth/email-already-in-use") msg = "Email already registered.";
      else if (code === "auth/invalid-email") msg = "Invalid email.";
      else if (code === "auth/weak-password") msg = "Password too weak.";
      else if (code === "auth/operation-not-allowed") msg = "Email/Password not enabled.";
      push("Failed: " + msg, "error", 6000);
    } finally { setRegistering(false); }
  };

  const canManage = useCallback((u) => !isSubAdmin || !ADMIN_ROLES.includes(u.role), [isSubAdmin]);

  return (
    <div className="card">
      <div className="card-header-row">
        <h3 style={{ margin: 0 }}>Manage Users</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: THEME.gray }}>{filtered.length} of {users.length}</span>
          {!isSubAdmin && <button className="btn btn-outline btn-sm" onClick={() => setShowSubAdminForm((v) => !v)}>+ Register Sub-Admin</button>}
          {!showRegister && <button className="btn btn-primary btn-sm" onClick={startRegister}>+ Register User</button>}
        </div>
      </div>

      <div style={{ background: THEME.primaryLight, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: THEME.inkMuted, marginBottom: 14, lineHeight: 1.5 }}>
        <b>Tip:</b> Click <b>Change role</b> to move a user through the workflow (Requestor → Verifier → Confirmer → Initial Approver → Final Approver).
        {!isSubAdmin && " You can also promote someone to admin if they need full control of this organization."} At least one admin must remain.
      </div>

      {showSubAdminForm && !isSubAdmin && (
        <div style={{ background: THEME.primaryLight, borderRadius: 10, padding: 18, marginBottom: 16, borderLeft: `3px solid ${THEME.primary}` }}>
          <SubAdminRegister projects={projects}
            onSuccess={() => { setShowSubAdminForm(false); push("Sub-Admin registered successfully.", "success"); }}
            onCancel={() => setShowSubAdminForm(false)} />
        </div>
      )}

      {showRegister && (
        <form className="inline-form" onSubmit={registerUser}>
          <div className="form-row">
            <div className="form-group"><label>Full Name</label>
              <input required value={regForm.name} onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} placeholder="e.g. Ahmed Al-Saud" />
            </div>
            <div className="form-group"><label>Email</label>
              <input required type="email" value={regForm.email} onChange={(e) => setRegForm({ ...regForm, email: e.target.value })} placeholder="user@company.com" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Temporary Password</label>
              <div style={{ display: "flex", gap: 6 }}>
                <input required type={showPassword ? "text" : "password"} minLength={6}
                  value={regForm.password} onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                  placeholder="At least 6 characters" style={{ flex: 1, minWidth: 0 }} />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowPassword((s) => !s)}>{showPassword ? "Hide" : "Show"}</button>
              </div>
              <PasswordStrength password={regForm.password} />
            </div>
            <div className="form-group"><label>Role</label>
              <select value={regForm.role} onChange={(e) => setRegForm({ ...regForm, role: e.target.value })}>
                {allowedRoleOptions.map((r) => <option key={r} value={r}>{roleLabelOf(r)}</option>)}
              </select>
              {resolveRoleExplanation(regForm.role) && (
                <div style={{ fontSize: 11, color: THEME.gray, marginTop: 4, lineHeight: 1.4 }}>{resolveRoleExplanation(regForm.role)}</div>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>Assign to Projects ({regForm.projectIds.length})</label>
            <ProjectChips projects={projects} selected={regForm.projectIds}
              onToggle={(pid) => setRegForm((f) => ({ ...f, projectIds: f.projectIds.includes(pid) ? f.projectIds.filter((x) => x !== pid) : [...f.projectIds, pid] }))} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={registering}>{registering ? "Registering…" : "Register User"}</button>
            <button type="button" className="btn btn-outline" onClick={cancelRegister} disabled={registering}>Cancel</button>
          </div>
        </form>
      )}

      <div className="filter-bar">
        <input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabelOf(r)}</option>)}
        </select>
      </div>

      {filtered.length === 0 && <div className="empty-state">No users match the filter.</div>}

      {filtered.length > 0 && !isMobile && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Role</th>
                <th style={{ minWidth: 180 }}>Projects</th>
                <th style={{ width: 360 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const isSelf = u.id === currentUid;
                const isEditing = editingUserId === u.id;
                const assigned = Array.isArray(u.projectIds) ? u.projectIds : [];
                const canEditRole = canManage(u);
                return isEditing ? (
                  <EditUserRow key={u.id} user={u} disabled={savingId === u.id}
                    emailExists={(email) => emailExists(email, u.id)}
                    onCancel={() => setEditingUserId(null)}
                    onSave={(patch) => updateUser(u.id, patch)}
                    allowEmailEdit={false} isSubAdmin={isSubAdmin} roleLabelOf={roleLabelOf} />
                ) : (
                  <tr key={u.id}>
                    <td>{u.name || "—"}{isSelf && <span style={{ marginLeft: 6, fontSize: 11, padding: "1px 6px", borderRadius: 999, background: THEME.primaryLight, color: THEME.primaryDark }}>you</span>}</td>
                    <td>{u.email || "—"}</td>
                    <td>
                      <button type="button" className="badge"
                        onClick={() => canEditRole && setRoleUser(u)}
                        disabled={!canEditRole}
                        title={canEditRole ? "Click to change role" : "You cannot edit this role"}
                        style={{ cursor: canEditRole ? "pointer" : "not-allowed",
                          border: `1px solid ${canEditRole ? THEME.border : "transparent"}`, background: THEME.bg }}>
                        {roleLabelOf(u.role)}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13 }}>{assigned.length === 0 ? <span style={{ color: THEME.gray }}>None</span> : <><b>{assigned.length}</b> {assigned.length === 1 ? "project" : "projects"}</>}</span>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setAssigningUser(u)} disabled={!canEditRole}>Manage</button>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setRoleUser(u)} disabled={!canEditRole}>Change role</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingUserId(u.id)} disabled={!canEditRole}>Edit</button>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => setPasswordUser(u)}>Password</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => removeUser(u.id, u.email || u.id)} disabled={isSelf || !canEditRole}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((u) => {
            const isSelf = u.id === currentUid;
            const assigned = Array.isArray(u.projectIds) ? u.projectIds : [];
            const isEditing = editingUserId === u.id;
            const canEditRole = canManage(u);
            return (
              <div key={u.id} style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12 }}>
                {isEditing ? (
                  <MobileEditUserCard user={u} disabled={savingId === u.id}
                    emailExists={(email) => emailExists(email, u.id)}
                    onCancel={() => setEditingUserId(null)}
                    onSave={(patch) => updateUser(u.id, patch)}
                    isSubAdmin={isSubAdmin} roleLabelOf={roleLabelOf} />
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{u.name || "—"}{isSelf && <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: THEME.primaryLight, color: THEME.primaryDark }}>you</span>}</div>
                        <div style={{ fontSize: 12, color: THEME.gray }}>{u.email || "—"}</div>
                      </div>
                      <button type="button" className="badge"
                        onClick={() => canEditRole && setRoleUser(u)}
                        disabled={!canEditRole}
                        style={{ cursor: canEditRole ? "pointer" : "not-allowed", border: "none" }}>
                        {roleLabelOf(u.role)}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: THEME.gray, marginTop: 8 }}>Projects: {assigned.length || "None"}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setRoleUser(u)} disabled={!canEditRole} style={{ flex: 1 }}>Role</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAssigningUser(u)} disabled={!canEditRole} style={{ flex: 1 }}>Projects</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditingUserId(u.id)} disabled={!canEditRole} style={{ flex: 1 }}>Edit</button>
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setPasswordUser(u)} style={{ flex: 1 }}>Password</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeUser(u.id, u.email || u.id)} disabled={isSelf || !canEditRole} style={{ flex: 1 }}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assigningUser && (
        <AssignProjectsModal user={assigningUser} projects={projects}
          saving={savingId === assigningUser.id}
          onClose={() => setAssigningUser(null)}
          onSave={(ids) => saveProjectAssignments(assigningUser.id, ids)} isMobile={isMobile} />
      )}
      {passwordUser && <ChangePasswordModal user={passwordUser} push={push} onClose={() => setPasswordUser(null)} isMobile={isMobile} />}
      {roleUser && (
        <RolePickerModal user={roleUser}
          isSelf={roleUser.id === currentUid}
          adminCount={adminCount}
          isSubAdmin={isSubAdmin}
          roleLabelOf={roleLabelOf}
          onSave={(nextRole) => changeRole(roleUser.id, nextRole)}
          onClose={() => setRoleUser(null)} isMobile={isMobile} />
      )}
      {deleteTarget && (
        <ConfirmDialog title="Delete user profile"
          message={<>This will delete the profile of <b>{deleteTarget.email}</b>. Their Firebase Auth account will remain. Continue?</>}
          confirmLabel="Delete" danger
          onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} isMobile={isMobile} />
      )}
    </div>
  );
}

function EditUserRow({ user, onCancel, onSave, disabled, emailExists, allowEmailEdit = false, isSubAdmin, roleLabelOf }) {
  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [role, setRole] = useState(user.role || "");
  const roleOptions = useMemo(() => assignableRoles(isSubAdmin ? "subAdmin" : "admin"), [isSubAdmin]);
  const save = () => {
    const n = name.trim(), e = normalizeEmail(email);
    if (!n) return alert("Name is required.");
    if (!isValidEmail(e)) return alert("Valid email required.");
    if (emailExists(e)) return alert("Another user already uses that email.");
    const patch = { name: n, role }; if (allowEmailEdit) patch.email = e; onSave(patch);
  };
  return (
    <tr style={{ background: THEME.primaryLight }}>
      <td><input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} /></td>
      <td><input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} disabled={!allowEmailEdit} /></td>
      <td><select value={role} onChange={(e) => setRole(e.target.value)}>{roleOptions.map((r) => <option key={r} value={r}>{roleLabelOf(r)}</option>)}</select></td>
      <td colSpan={2}>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={save}>{disabled ? "Saving…" : "Save"}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onCancel} disabled={disabled}>Cancel</button>
        </div>
      </td>
    </tr>
  );
}
function MobileEditUserCard({ user, onCancel, onSave, disabled, isSubAdmin, roleLabelOf }) {
  const [name, setName] = useState(user.name || "");
  const [role, setRole] = useState(user.role || "");
  const roleOptions = useMemo(() => assignableRoles(isSubAdmin ? "subAdmin" : "admin"), [isSubAdmin]);
  const save = () => { const n = name.trim(); if (!n) return alert("Name required."); onSave({ name: n, role }); };
  return (
    <div>
      <div className="form-group"><label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }} />
      </div>
      <div className="form-group"><label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
          {roleOptions.map((r) => <option key={r} value={r}>{roleLabelOf(r)}</option>)}
        </select>
        {resolveRoleExplanation(role) && <div style={{ fontSize: 11, color: THEME.gray, marginTop: 4, lineHeight: 1.4 }}>{resolveRoleExplanation(role)}</div>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={save} style={{ flex: 1 }}>{disabled ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-outline btn-sm" onClick={onCancel} disabled={disabled} style={{ flex: 1 }}>Cancel</button>
      </div>
    </div>
  );
}
function ProjectChips({ projects, selected, onToggle }) {
  if (projects.length === 0) return <div className="empty-state" style={{ padding: 8 }}>No projects yet.</div>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 0", maxHeight: 180, overflowY: "auto" }}>
      {projects.map((p) => {
        const c = selected.includes(p.id);
        return (
          <label key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
            border: "1px solid", borderColor: c ? THEME.primary : THEME.border,
            background: c ? THEME.primaryLight : "transparent",
            borderRadius: 999, cursor: "pointer", fontSize: 13 }}>
            <input type="checkbox" checked={c} onChange={() => onToggle(p.id)} />{projectLabel(p)}
          </label>
        );
      })}
    </div>
  );
}
function PasswordStrength({ password }) {
  if (!password) return null;
  let score = 0;
  if (password.length >= 6) score++; if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++; if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ["Very weak","Weak","Fair","Good","Strong","Very strong"];
  const colors = ["#dc2626","#f97316","#f59e0b","#10b981","#059669","#047857"];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 4, background: THEME.border, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${(score/5)*100}%`, height: "100%", background: colors[Math.min(score, colors.length - 1)] }} />
      </div>
      <div style={{ fontSize: 11, color: colors[Math.min(score, colors.length - 1)], marginTop: 2 }}>{labels[Math.min(score, labels.length - 1)]}</div>
    </div>
  );
}

function ProjectsTab({ projects, users, requests, organizationId, push, isMobile, isSubAdmin }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", location: "", initialApproverId: "", finalApproverId: "" });
  const [membersProject, setMembersProject] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const initialApprovers = useMemo(() => users.filter((u) => u.role === "initialApprover"), [users]);
  const finalApprovers = useMemo(() => users.filter((u) => u.role === "finalApprover"), [users]);
  const usersById = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u; }); return m; }, [users]);
  const nameOf = useCallback((uid) => { if (!uid) return "—"; const u = usersById[uid]; return u ? (u.name || u.email) : "—"; }, [usersById]);
  const stats = useMemo(() => {
    const map = {};
    requests.forEach((r) => {
      const k = r.projectId || r.projectName;
      if (!map[k]) map[k] = { approvedHours: 0, count: 0 };
      if (ALL_APPROVED.includes(r.status)) map[k].approvedHours += shiftHours(r.startTime, r.endTime);
      map[k].count++;
    });
    return map;
  }, [requests]);
  const membersOf = useCallback((pid) => users.filter((u) => (u.projectIds || []).includes(pid)), [users]);

  const startNew = useCallback(() => {
    setEditing(null); setForm({ name: "", code: "", location: "", initialApproverId: "", finalApproverId: "" }); setShowForm(true);
  }, []);
  const startEdit = useCallback((p) => {
    setEditing(p.id);
    setForm({ name: p.name || "", code: p.code || "", location: p.location || "",
      initialApproverId: p.initialApproverId || "", finalApproverId: p.finalApproverId || "" });
    setShowForm(true);
  }, []);
  const cancel = useCallback(() => {
    setShowForm(false); setEditing(null);
    setForm({ name: "", code: "", location: "", initialApproverId: "", finalApproverId: "" });
  }, []);

  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    const payload = {
      name: form.name.trim(), code: form.code.trim().toUpperCase(), location: form.location.trim(),
      initialApproverId: form.initialApproverId || null, finalApproverId: form.finalApproverId || null,
      organizationId, updatedAt: serverTimestamp(),
    };
    try {
      if (editing) { await updateDoc(doc(db, "projects", editing), payload); push("Project updated", "success"); }
      else { await addDoc(collection(db, "projects"), { ...payload, createdAt: serverTimestamp() }); push("Project created", "success"); }
      cancel();
    } catch (err) { push("Failed to save project: " + err.message, "error"); }
    finally { setSaving(false); }
  };

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget; setDeleteTarget(null);
    try { await deleteDoc(doc(db, "projects", target.id)); push("Project deleted", "success"); }
    catch (err) { push("Failed to delete project: " + err.message, "error"); }
  }, [deleteTarget, push]);
  const remove = useCallback((p) => setDeleteTarget(p), []);

  return (
    <div className="card">
      <div className="card-header-row">
        <h3 style={{ margin: 0 }}>Manage Projects</h3>
        {!showForm && !isSubAdmin && <button className="btn btn-primary btn-sm" onClick={startNew}>+ New Project</button>}
      </div>

      {showForm && !isSubAdmin && (
        <form className="inline-form" onSubmit={save}>
          <div className="form-row">
            <div className="form-group"><label>Project Name</label>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group"><label>Project Code</label>
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. PRJ-001" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Location</label>
              <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="form-group"><label>Initial Approver</label>
              <select value={form.initialApproverId} onChange={(e) => setForm({ ...form, initialApproverId: e.target.value })}>
                <option value="">-- none --</option>
                {initialApprovers.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Final Approver (internal)</label>
              <select value={form.finalApproverId} onChange={(e) => setForm({ ...form, finalApproverId: e.target.value })}>
                <option value="">-- none --</option>
                {finalApprovers.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : editing ? "Update" : "Create"}</button>
            <button type="button" className="btn btn-outline" onClick={cancel}>Cancel</button>
          </div>
        </form>
      )}

      {projects.length === 0 && <div className="empty-state">No projects yet.</div>}

      {projects.length > 0 && !isMobile && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Code</th><th>Name</th><th>Location</th><th>Initial Approver</th><th>Final Approver</th><th>Members</th><th>Approved Hrs</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const s = stats[p.id] || { approvedHours: 0, count: 0 };
                const m = membersOf(p.id);
                return (
                  <tr key={p.id}>
                    <td><b>{p.code || "—"}</b></td>
                    <td>{p.name}</td>
                    <td>{p.location || "—"}</td>
                    <td>{p.initialApproverId ? nameOf(p.initialApproverId) : "—"}</td>
                    <td>{p.finalApproverId ? nameOf(p.finalApproverId) : "—"}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => setMembersProject(p)}>
                        {m.length} {m.length === 1 ? "member" : "members"}
                      </button>
                    </td>
                    <td><b style={{ color: THEME.primaryDark }}>{fmtHours(s.approvedHours)}</b></td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {!isSubAdmin && (
                          <>
                            <button className="btn btn-outline btn-sm" onClick={() => startEdit(p)}>Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={() => remove(p)}>Delete</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {projects.length > 0 && isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((p) => {
            const s = stats[p.id] || { approvedHours: 0, count: 0 };
            const m = membersOf(p.id);
            return (
              <div key={p.id} style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: THEME.gray }}>{p.code || "—"} · {p.location || "—"}</div>
                  </div>
                  <span className="badge">{fmtHours(s.approvedHours)}</span>
                </div>
                <div style={{ fontSize: 12, color: THEME.gray, marginTop: 8 }}>
                  Initial Approver: {p.initialApproverId ? nameOf(p.initialApproverId) : "—"} · Final Approver: {p.finalApproverId ? nameOf(p.finalApproverId) : "—"} · Members: {m.length} · Requests: {s.count}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setMembersProject(p)} style={{ flex: 1 }}>Members</button>
                  {!isSubAdmin && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(p)} style={{ flex: 1 }}>Edit</button>
                      <button className="btn btn-danger btn-sm" onClick={() => remove(p)} style={{ flex: 1 }}>Delete</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {membersProject && (
        <MembersModal project={membersProject} users={users} push={push}
          onClose={() => setMembersProject(null)} isMobile={isMobile} />
      )}
      {deleteTarget && (
        <ConfirmDialog title="Delete project"
          message={<>Delete <b>{deleteTarget.code ? `[${deleteTarget.code}] ` : ""}{deleteTarget.name}</b>? Members will keep their profile but lose this project assignment.</>}
          confirmLabel="Delete" danger
          onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} isMobile={isMobile} />
      )}
    </div>
  );
}

function MembersModal({ project, users, push, onClose, isMobile }) {
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 150);
  const [busy, setBusy] = useState(false);
  const { label: roleLabelOf } = useRoleLabels();

  const members = useMemo(() => users.filter((u) => (u.projectIds || []).includes(project.id)), [users, project.id]);
  const visible = useMemo(() => {
    if (!debounced) return users;
    const q = debounced.toLowerCase();
    return users.filter((u) =>
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      roleLabelOf(u.role).toLowerCase().includes(q));
  }, [users, debounced, roleLabelOf]);

  const toggle = useCallback(async (user) => {
    const has = (user.projectIds || []).includes(project.id);
    const next = has ? (user.projectIds || []).filter((id) => id !== project.id) : [...(user.projectIds || []), project.id];
    setBusy(true);
    try { await updateDoc(doc(db, "users", user.id), { projectIds: next }); push(has ? "Member removed" : "Member added", "success"); }
    catch (err) { push("Failed: " + err.message, "error"); }
    finally { setBusy(false); }
  }, [project.id, push]);

  return (
    <Modal title={`Members of ${project.code || ""} ${project.name}`} onClose={onClose} isMobile={isMobile}>
      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${THEME.border}` }}>
        <input placeholder="Search by name, email or role" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", padding: 10, boxSizing: "border-box", border: `1px solid ${THEME.border}`, borderRadius: 6 }} />
        <div style={{ fontSize: 13, color: THEME.gray, marginTop: 6 }}>{members.length} member{members.length === 1 ? "" : "s"} · tap to toggle</div>
      </div>
      <div style={{ padding: "8px 18px", overflowY: "auto", flex: 1, maxHeight: "60dvh" }}>
        {visible.map((u) => {
          const isMember = (u.projectIds || []).includes(project.id);
          return (
            <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
              borderBottom: `1px solid ${THEME.border}`, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1 }}>
              <input type="checkbox" checked={isMember} disabled={busy} onChange={() => toggle(u)} />
              <span style={{ flex: 1 }}><b>{u.name || u.email}</b><span style={{ marginLeft: 8, fontSize: 12, color: THEME.gray }}>{roleLabelOf(u.role)}</span></span>
            </label>
          );
        })}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function RequestsTab({ requests, users, push, isMobile, isSubAdmin, organizationName }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [flowFilter, setFlowFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [editingReq, setEditingReq] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const usersById = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u; }); return m; }, [users]);
  const nameOf = useCallback((uid, fallback) => {
    if (!uid) return fallback || "—";
    const u = usersById[uid];
    return u ? (u.name || u.email) : fallback || uid;
  }, [usersById]);

  const projects = useMemo(() => {
    const set = new Map();
    requests.forEach((r) => {
      const key = r.projectId || r.projectName;
      if (!set.has(key)) set.set(key, { id: r.projectId, name: r.projectName, code: r.projectCode });
    });
    return Array.from(set.values()).sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  }, [requests]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (projectFilter !== "all" && (r.projectId || r.projectName) !== projectFilter) return false;
      if (flowFilter === "requestor" && isInternalRequest(r)) return false;
      if (flowFilter === "internal" && !isInternalRequest(r)) return false;
      if (fromDate && r.date < fromDate) return false;
      if (toDate && r.date > toDate) return false;
      return true;
    }).sort((a, b) => {
      if (a.date !== b.date) return (b.date || "").localeCompare(a.date || "");
      return (b.startTime || "").localeCompare(a.startTime || "");
    });
  }, [requests, statusFilter, projectFilter, flowFilter, fromDate, toDate]);

  const totalHours = useMemo(() => filtered.reduce((s, r) => s + shiftHours(r.startTime, r.endTime), 0), [filtered]);

  const exportCSV = useCallback(() => {
    if (filtered.length === 0) return push("No requests match.", "error");
    setExporting(true);
    try {
      const rows = filtered.map((r) => ({
        Date: r.date, Start: r.startTime, End: r.endTime,
        Hours: shiftHours(r.startTime, r.endTime).toFixed(2),
        ProjectCode: r.projectCode || "", Project: r.projectName, Task: r.taskDescription,
        Type: isInternalRequest(r) ? "Internal" : "Requestor",
        Requestor: r.requestorName || (isInternalRequest(r) ? "(internal)" : ""),
        Verifier: nameOf(r.verifierId, r.verifierEmail),
        Confirmer: nameOf(r.confirmerId, r.confirmerEmail),
        "Initial Approver": nameOf(r.initialApproverId, r.initialApproverEmail),
        "Final Approver": nameOf(r.finalApproverId, r.finalApproverEmail),
        Status: r.status, RejectionReason: r.rejectionReason || "",
      }));
      const csv = Papa.unparse(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `admin_requests_${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
    } catch (err) { push("CSV failed: " + err.message, "error"); }
    finally { setExporting(false); }
  }, [filtered, nameOf, push]);

  const exportPDF = useCallback(() => {
    if (filtered.length === 0) return push("No requests match.", "error");
    setExportingPDF(true);
    try {
      const range = fromDate && toDate ? `${fromDate} to ${toDate}`
        : fromDate ? `from ${fromDate}` : toDate ? `until ${toDate}` : "All dates";
      buildOvertimeReportPDF({
        requests: filtered, inspectors: usersById, title: "Company Overtime Report",
        dateRange: range, supervisorName: auth.currentUser?.email || "",
        organizationName, action: "review",
      });
    } catch (err) { push("PDF failed: " + err.message, "error"); }
    finally { setExportingPDF(false); }
  }, [filtered, fromDate, toDate, usersById, organizationName, push]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const target = deleteTarget; setDeleteTarget(null);
    try { await deleteDoc(doc(db, "overtime_requests", target.id)); push("Request deleted", "success"); }
    catch (err) { push("Failed: " + err.message, "error"); }
  }, [deleteTarget, push]);
  const deleteRequest = useCallback((r) => setDeleteTarget(r), []);
  const saveEdit = useCallback(async (id, patch) => {
    try { await updateDoc(doc(db, "overtime_requests", id), patch); push("Request updated", "success"); setEditingReq(null); }
    catch (err) { push("Failed to update: " + err.message, "error"); }
  }, [push]);

  return (
    <div className="card">
      <div className="card-header-row">
        <h3 style={{ margin: 0 }}>All Requests</h3>
        <span style={{ fontSize: 13, color: THEME.gray }}>{filtered.length} of {requests.length} · {fmtHours(totalHours)}</span>
      </div>

      <div className="filter-bar">
        <div><label className="export-label">Status</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div><label className="export-label">Flow</label>
          <select value={flowFilter} onChange={(e) => setFlowFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="requestor">Requestor</option>
            <option value="internal">Internal</option>
          </select>
        </div>
        <div><label className="export-label">Project</label>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id || p.name} value={p.id || p.name}>{p.code ? `[${p.code}] ` : ""}{p.name}</option>)}
          </select>
        </div>
        <div><label className="export-label">From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div><label className="export-label">To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="export-bar" style={{ marginBottom: 14 }}>
        <button className="btn btn-secondary btn-sm" disabled={exporting || filtered.length === 0} onClick={exportCSV}>{exporting ? "Exporting…" : "Export CSV"}</button>
        <button className="btn btn-gold btn-sm" disabled={exportingPDF || filtered.length === 0} onClick={exportPDF}>📄 {exportingPDF ? "Building…" : "Export PDF"}</button>
      </div>

      {filtered.length === 0 && <div className="empty-state">No requests match the filter.</div>}

      {filtered.length > 0 && !isMobile && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>Date</th><th>Project</th><th>Type</th><th>Time</th><th>Hours</th><th>Requestor</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const internal = isInternalRequest(r);
                return (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.projectCode ? `[${r.projectCode}] ` : ""}{r.projectName}</td>
                    <td>{internal ? <span className="badge" style={{ background: "#FBEBC7", color: "#7A4A0E" }}>Internal</span> : <span className="badge">Requestor</span>}</td>
                    <td>{r.startTime} → {r.endTime}{r.endTime < r.startTime && " (+1d)"}</td>
                    <td><b>{fmtHours(shiftHours(r.startTime, r.endTime))}</b></td>
                    <td>{internal ? nameOf(r.requestedBy || r.confirmerId, r.confirmerEmail) : r.requestorName}</td>
                    <td><span className={STATUS_BADGE[r.status] || "badge badge-pending"}>{STATUS_LABELS[r.status] || r.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => setEditingReq(r)}>Edit</button>
                        {!isSubAdmin && <button className="btn btn-danger btn-sm" onClick={() => deleteRequest(r)}>Delete</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && isMobile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => {
            const internal = isInternalRequest(r);
            return (
              <div key={r.id} style={{ background: THEME.card, border: `1px solid ${THEME.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{r.date}</div>
                    <div style={{ fontSize: 12, color: THEME.gray }}>{r.projectCode ? `[${r.projectCode}] ` : ""}{r.projectName}</div>
                  </div>
                  <span className={STATUS_BADGE[r.status] || "badge badge-pending"}>{STATUS_LABELS[r.status] || r.status}</span>
                </div>
                <div style={{ fontSize: 12, color: THEME.gray, marginTop: 6 }}>
                  {internal ? "Internal" : "Requestor"} · {r.startTime} → {r.endTime}{r.endTime < r.startTime && " (+1d)"} · {fmtHours(shiftHours(r.startTime, r.endTime))}
                </div>
                <div style={{ fontSize: 12, color: THEME.gray }}>
                  {internal ? `Requested by: ${nameOf(r.requestedBy || r.confirmerId, r.confirmerEmail)}` : `Requestor: ${r.requestorName}`}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setEditingReq(r)} style={{ flex: 1 }}>Edit</button>
                  {!isSubAdmin && <button className="btn btn-danger btn-sm" onClick={() => deleteRequest(r)} style={{ flex: 1 }}>Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingReq && (
        <EditRequestModal request={editingReq}
          onClose={() => setEditingReq(null)}
          onSave={(patch) => saveEdit(editingReq.id, patch)} isMobile={isMobile} />
      )}
      {deleteTarget && (
        <ConfirmDialog title="Delete request"
          message={<>Delete the overtime request for <b>{deleteTarget.date}</b> ({deleteTarget.projectCode ? `[${deleteTarget.projectCode}] ` : ""}{deleteTarget.projectName})? This action cannot be undone.</>}
          confirmLabel="Delete" danger
          onConfirm={confirmDelete} onCancel={() => setDeleteTarget(null)} isMobile={isMobile} />
      )}
    </div>
  );
}

function EditRequestModal({ request, onClose, onSave, isMobile }) {
  const [status, setStatus] = useState(request.status || "pending_verifier");
  const [reason, setReason] = useState(request.rejectionReason || "");
  const [saving, setSaving] = useState(false);
  const isRejected = status.startsWith("rejected");
  const submit = async () => {
    if (isRejected && !reason.trim()) { alert("Rejection reason is required for rejected statuses."); return; }
    setSaving(true);
    try { await onSave({ status, rejectionReason: reason }); }
    finally { setSaving(false); }
  };
  return (
    <Modal title={`Edit Request — ${request.date}`} onClose={onClose} isMobile={isMobile}>
      <div style={{ padding: 18 }}>
        <div className="form-group">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "100%", boxSizing: "border-box" }}>
            {Object.keys(STATUS_LABELS).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Rejection Reason {isRejected && <span style={{ color: THEME.danger }}>*</span>}</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder={isRejected ? "Required" : "Optional"}
            style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end", gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}