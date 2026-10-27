import { useEffect, useState, useCallback, useMemo } from "react";
import {
  collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, setDoc, serverTimestamp, writeBatch,
} from "firebase/firestore";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { db, auth, getSecondaryAuth } from "../firebase";

const THEME = {
  primary: "#A0522D", primaryDark: "#7A3A1E", primaryLight: "#F4E4D4",
  ink: "#2B1D14", inkMuted: "#4A3525", gray: "#8B7355",
  border: "#E8D9C4", bg: "#FAF3E7", card: "#FFFCF6", danger: "#B8442E",
  gold: "#C8A24A", success: "#2F6B3F",
};

const ADMIN_ROLES = ["admin", "subAdmin"];

/* ================================================================== */
/*  Hooks                                                              */
/* ================================================================== */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = "success", ttl = 3500) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

function useDebouncedValue(value, delay = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function useEscapeKey(handler, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e) => { if (e.key === "Escape") handler(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [handler, active]);
}

/* ================================================================== */
/*  UI atoms                                                           */
/* ================================================================== */
function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      style={{
        position: "fixed", top: 16, right: 16, left: 16, maxWidth: 380,
        marginLeft: "auto", zIndex: 3000, display: "flex",
        flexDirection: "column", gap: 8, pointerEvents: "none",
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          onClick={() => onDismiss(t.id)}
          style={{
            pointerEvents: "auto", cursor: "pointer", padding: "10px 14px",
            borderRadius: 8, color: "#fff", fontSize: 13,
            boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
            background:
              t.kind === "error" ? THEME.danger
              : t.kind === "success" ? THEME.success
              : THEME.primaryDark,
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  useEscapeKey(onClose);
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(43,29,20,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2500, padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: THEME.card, borderRadius: 10, width: "100%",
          maxWidth: 520, maxHeight: "85dvh", display: "flex",
          flexDirection: "column", overflow: "hidden",
          boxShadow: "0 12px 32px rgba(43,29,20,0.25)",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${THEME.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 16, color: THEME.ink }}>{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: "transparent", border: "none", fontSize: 20, color: THEME.gray, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ title = "Please confirm", message, confirmLabel = "Confirm", danger = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{ padding: 18, fontSize: 14, color: THEME.inkMuted }}>{message}</div>
      <div style={{ padding: 12, borderTop: `1px solid ${THEME.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" onClick={onCancel}
          style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: "transparent", cursor: "pointer" }}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}
          style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: danger ? THEME.danger : THEME.primary, color: "#fff", cursor: "pointer" }}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

function PasswordStrength({ password }) {
  if (!password) return null;
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["#dc2626", "#f97316", "#f59e0b", "#10b981", "#059669", "#047857"];
  const label = labels[Math.min(score, labels.length - 1)];
  const color = colors[Math.min(score, colors.length - 1)];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ height: 4, background: THEME.border, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${(score / 5) * 100}%`, height: "100%", background: color, transition: "width 150ms ease" }} />
      </div>
      <div style={{ fontSize: 11, color, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ background: THEME.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${THEME.border}`, flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: THEME.ink }}>{value}</div>
      <div style={{ fontSize: 11, color: THEME.gray, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}

/* ================================================================== */
/*  Main                                                               */
/* ================================================================== */
export default function SuperAdminDashboard() {
  const [orgs, setOrgs] = useState([]);
  const [orgsLoading, setOrgsLoading] = useState(true);
  const [adminsByOrg, setAdminsByOrg] = useState({});
  const [usersByOrg, setUsersByOrg] = useState({});
  const [requestsByOrg, setRequestsByOrg] = useState({});
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 200);
  const [sortBy, setSortBy] = useState("name"); // name | users | requests
  const { toasts, push, dismiss } = useToasts();

  /* ----- Org list ----- */
  useEffect(() => {
    const q = query(collection(db, "organizations"), orderBy("name"));
    return onSnapshot(q, (snap) => {
      setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setOrgsLoading(false);
    });
  }, []);

  /* ----- Admins by org ----- */
  useEffect(() => {
    const q = query(collection(db, "users"), where("role", "in", ADMIN_ROLES));
    return onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const u = { id: d.id, ...d.data() };
        if (!u.organizationId) return;
        if (!map[u.organizationId]) map[u.organizationId] = [];
        map[u.organizationId].push(u);
      });
      setAdminsByOrg(map);
    });
  }, []);

  /* ----- Users by org (all roles) ----- */
  useEffect(() => {
    const q = query(collection(db, "users"));
    return onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const u = { id: d.id, ...d.data() };
        if (!u.organizationId) return;
        map[u.organizationId] = (map[u.organizationId] || 0) + 1;
      });
      setUsersByOrg(map);
    });
  }, []);

  /* ----- Requests by org ----- */
  useEffect(() => {
    const q = query(collection(db, "overtime_requests"));
    return onSnapshot(q, (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const r = d.data();
        const key = r.organizationId;
        if (!key) return;
        if (!map[key]) map[key] = { total: 0, pending: 0 };
        map[key].total++;
        if (typeof r.status === "string" && r.status.startsWith("pending")) map[key].pending++;
      });
      setRequestsByOrg(map);
    });
  }, []);

  const handleLogout = useCallback(async () => {
    if (!window.confirm("Sign out?")) return;
    await signOut(auth);
  }, []);

  /* ----- Filtering + sorting ----- */
  const filteredOrgs = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const list = q
      ? orgs.filter(
          (o) =>
            (o.name || "").toLowerCase().includes(q) ||
            o.id.toLowerCase().includes(q)
        )
      : orgs;

    const sorted = [...list];
    if (sortBy === "users") {
      sorted.sort((a, b) => (usersByOrg[b.id] || 0) - (usersByOrg[a.id] || 0));
    } else if (sortBy === "requests") {
      sorted.sort((a, b) => (requestsByOrg[b.id]?.total || 0) - (requestsByOrg[a.id]?.total || 0));
    } else {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    }
    return sorted;
  }, [orgs, debouncedSearch, sortBy, usersByOrg, requestsByOrg]);

  const totals = useMemo(() => {
    const adminCount = Object.values(adminsByOrg).reduce((s, a) => s + a.length, 0);
    const userCount = Object.values(usersByOrg).reduce((s, n) => s + n, 0);
    return { orgs: orgs.length, admins: adminCount, users: userCount };
  }, [orgs, adminsByOrg, usersByOrg]);

  return (
    <div style={{ minHeight: "100dvh", background: THEME.bg, padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, color: THEME.ink, fontSize: 22 }}>Platform Admin</h1>
            <p style={{ margin: "4px 0 0", color: THEME.gray, fontSize: 13 }}>
              Manage organizations and their admin accounts
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                style={{ background: THEME.primary, color: "#fff", border: "none", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
              >
                + New Organization
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              style={{ background: "transparent", border: `1px solid ${THEME.border}`, padding: "10px 16px", borderRadius: 8, cursor: "pointer", color: THEME.gray }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <Stat label="Organizations" value={totals.orgs} />
          <Stat label="Admins" value={totals.admins} />
          <Stat label="Users" value={totals.users} />
        </div>

        {/* Create form */}
        {showForm && (
          <NewOrgForm
            onCreated={() => { setShowForm(false); push("Organization created.", "success"); }}
            onCancel={() => setShowForm(false)}
            onError={(e) => push(e, "error")}
          />
        )}

        {/* Search + sort */}
        {orgs.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <input
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: 1, minWidth: 220, padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 8, fontSize: 14, boxSizing: "border-box" }}
            />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 8, fontSize: 14, background: THEME.card }}
            >
              <option value="name">Sort: Name</option>
              <option value="users">Sort: Most users</option>
              <option value="requests">Sort: Most requests</option>
            </select>
          </div>
        )}

        {/* Body */}
        {orgsLoading ? (
          <div style={{ background: THEME.card, borderRadius: 12, padding: 40, textAlign: "center", color: THEME.gray }}>
            Loading organizations…
          </div>
        ) : orgs.length === 0 ? (
          <div style={{ background: THEME.card, borderRadius: 12, padding: 40, textAlign: "center", color: THEME.gray }}>
            No organizations yet. Click "New Organization" to create the first one.
          </div>
        ) : filteredOrgs.length === 0 ? (
          <div style={{ background: THEME.card, borderRadius: 12, padding: 40, textAlign: "center", color: THEME.gray }}>
            No organizations match "{debouncedSearch}".
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {filteredOrgs.map((org) => (
              <OrgCard
                key={org.id}
                org={org}
                admins={adminsByOrg[org.id] || []}
                userCount={usersByOrg[org.id] || 0}
                requestStats={requestsByOrg[org.id] || { total: 0, pending: 0 }}
                onToast={push}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  New organization form                                              */
/* ================================================================== */
function NewOrgForm({ onCreated, onCancel, onError }) {
  const [form, setForm] = useState({ orgName: "", adminName: "", adminEmail: "", adminPassword: "" });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const { orgName, adminName, adminEmail, adminPassword } = form;
    if (!orgName.trim()) return onError("Organization name required.");
    if (!adminName.trim()) return onError("Admin name required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim()))
      return onError("Valid admin email required.");
    if (adminPassword.length < 6) return onError("Password must be 6+ characters.");

    setSaving(true);
    try {
      const orgRef = await addDoc(collection(db, "organizations"), {
        name: orgName.trim(),
        createdAt: serverTimestamp(),
      });
      const orgId = orgRef.id;

      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        adminEmail.trim().toLowerCase(),
        adminPassword
      );
      const newUid = cred.user.uid;
      try { await signOut(secondaryAuth); } catch {}

      await setDoc(doc(db, "users", newUid), {
        name: adminName.trim(),
        displayName: adminName.trim(),
        email: adminEmail.trim().toLowerCase(),
        role: "admin",
        organizationId: orgId,
        projectIds: [],
        scopedProjectIds: [],
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
      });

      onCreated();
    } catch (err) {
      const code = err.code || "";
      let msg = err.message;
      if (code === "auth/email-already-in-use") msg = "That admin email is already registered.";
      else if (code === "auth/invalid-email") msg = "Invalid email.";
      else if (code === "auth/weak-password") msg = "Password too weak.";
      else if (code === "auth/operation-not-allowed") msg = "Email/Password auth is not enabled.";
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}
      style={{ background: THEME.primaryLight, borderRadius: 10, padding: 20, marginBottom: 20, borderLeft: `3px solid ${THEME.primary}` }}>
      <h3 style={{ margin: "0 0 12px", color: THEME.ink }}>New Organization</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Organization Name
          <input required value={form.orgName}
            onChange={(e) => setForm({ ...form, orgName: e.target.value })}
            placeholder="e.g. Acme Construction"
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          First Admin Name
          <input required value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            placeholder="e.g. Ahmed Al-Saud"
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Admin Email
          <input required type="email" value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            placeholder="admin@acme.com"
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Admin Temp Password
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input required type={showPass ? "text" : "password"} minLength={6}
              value={form.adminPassword}
              onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
              placeholder="6+ characters"
              style={{ flex: 1, padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14 }} />
            <button type="button" onClick={() => setShowPass((s) => !s)}
              style={{ padding: "0 12px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: "#fff", cursor: "pointer" }}>
              {showPass ? "Hide" : "Show"}
            </button>
          </div>
          <PasswordStrength password={form.adminPassword} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving}
          style={{ background: THEME.primary, color: "#fff", border: "none", padding: "10px 16px", borderRadius: 8, cursor: "pointer", opacity: saving ? 0.6 : 1, fontWeight: 600 }}>
          {saving ? "Creating…" : "Create Organization + Admin"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${THEME.border}`, background: "transparent", cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ================================================================== */
/*  Add admin modal (for existing orgs)                                */
/* ================================================================== */
function AddAdminModal({ org, onClose, onToast }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "admin" });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return onToast("Name required.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return onToast("Valid email required.", "error");
    if (form.password.length < 6) return onToast("Password must be 6+ characters.", "error");

    setSaving(true);
    try {
      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth, form.email.trim().toLowerCase(), form.password
      );
      const uid = cred.user.uid;
      try { await signOut(secondaryAuth); } catch {}

      await setDoc(doc(db, "users", uid), {
        name: form.name.trim(),
        displayName: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        organizationId: org.id,
        projectIds: [],
        scopedProjectIds: [],
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.uid || null,
      });

      onToast(`Admin added to ${org.name}.`, "success");
      onClose();
    } catch (err) {
      const code = err.code || "";
      let msg = err.message;
      if (code === "auth/email-already-in-use") msg = "Email already registered.";
      else if (code === "auth/invalid-email") msg = "Invalid email.";
      else if (code === "auth/weak-password") msg = "Password too weak.";
      onToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Add Admin — ${org.name}`} onClose={onClose}>
      <form onSubmit={submit} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Full Name
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Sara Al-Otaibi"
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Email
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="admin@company.com"
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Temporary Password
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input required type={showPass ? "text" : "password"} minLength={6}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="6+ characters"
              style={{ flex: 1, padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14 }} />
            <button type="button" onClick={() => setShowPass((s) => !s)}
              style={{ padding: "0 12px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: "#fff", cursor: "pointer" }}>
              {showPass ? "Hide" : "Show"}
            </button>
          </div>
          <PasswordStrength password={form.password} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: 12, fontWeight: 600, color: THEME.inkMuted }}>
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            style={{ padding: 10, border: `1px solid ${THEME.border}`, borderRadius: 6, fontSize: 14, marginTop: 4 }}>
            <option value="admin">Admin</option>
            <option value="subAdmin">Sub-Admin (scoped)</option>
          </select>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <button type="button" onClick={onClose} disabled={saving}
            style={{ padding: "8px 14px", borderRadius: 6, border: `1px solid ${THEME.border}`, background: "transparent", cursor: "pointer" }}>
            Cancel
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: THEME.primary, color: "#fff", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Creating…" : "Create Admin"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ================================================================== */
/*  Org card                                                           */
/* ================================================================== */
function OrgCard({ org, admins, userCount, requestStats, onToast }) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(org.name || "");
  const [savingName, setSavingName] = useState(false);
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setDraftName(org.name || "");
  }, [org.name]);

  const saveName = useCallback(async () => {
    const next = draftName.trim();
    if (!next || next === org.name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    try {
      await updateDoc(doc(db, "organizations", org.id), { name: next });
      onToast("Organization renamed.", "success");
      setEditingName(false);
    } catch (err) {
      onToast("Rename failed: " + err.message, "error");
    } finally {
      setSavingName(false);
    }
  }, [draftName, org.id, org.name, onToast]);

  const doDelete = useCallback(async () => {
    setDeleteOpen(false);
    try {
      // Delete linked admin profiles (Auth users must be deleted separately)
      const batch = writeBatch(db);
      admins.forEach((a) => batch.delete(doc(db, "users", a.id)));
      batch.delete(doc(db, "organizations", org.id));
      await batch.commit();
      onToast(`Organization "${org.name}" deleted.`, "success");
    } catch (err) {
      onToast("Failed to delete: " + err.message, "error");
    }
  }, [admins, org.id, org.name, onToast]);

  const copyId = useCallback(() => {
    navigator.clipboard?.writeText(org.id).then(
      () => onToast("Org ID copied.", "success"),
      () => onToast("Copy failed.", "error")
    );
  }, [org.id, onToast]);

  const createdLabel = org.createdAt?.toDate
    ? org.createdAt.toDate().toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

  return (
    <div style={{ background: THEME.card, borderRadius: 12, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column" }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {editingName ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") { setDraftName(org.name || ""); setEditingName(false); }
                }}
                style={{ flex: 1, padding: "6px 8px", border: `1px solid ${THEME.primary}`, borderRadius: 6, fontSize: 15, fontWeight: 600 }}
              />
              <button type="button" onClick={saveName} disabled={savingName}
                style={{ padding: "0 10px", borderRadius: 6, border: "none", background: THEME.primary, color: "#fff", cursor: "pointer", fontSize: 12 }}>
                {savingName ? "…" : "Save"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <h3 style={{ margin: 0, color: THEME.ink, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {org.name}
              </h3>
              <button type="button" onClick={() => setEditingName(true)} aria-label="Rename organization"
                style={{ background: "transparent", border: "none", cursor: "pointer", color: THEME.gray, fontSize: 13 }}>✎</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: THEME.gray, marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace" }}>ID: {org.id.slice(0, 10)}…</span>
            <button type="button" onClick={copyId}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 11, color: THEME.primary, padding: 0 }}>
              copy
            </button>
            <span>·</span>
            <span>Created {createdLabel}</span>
          </div>
        </div>
        <button type="button" onClick={() => setDeleteOpen(true)}
          style={{ background: "transparent", border: `1px solid ${THEME.danger}`, color: THEME.danger, padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", flexShrink: 0 }}>
          Delete
        </button>
      </div>

      {/* Mini stats */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <MiniStat label="Users" value={userCount} />
        <MiniStat label="Admins" value={admins.length} />
        <MiniStat label="Requests" value={requestStats.total} />
        {requestStats.pending > 0 && (
          <MiniStat label="Pending" value={requestStats.pending} accent />
        )}
      </div>

      {/* Admins */}
      <div style={{ marginTop: 14, flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: THEME.gray, textTransform: "uppercase", letterSpacing: "0.4px" }}>
            Admin{admins.length === 1 ? "" : "s"}
          </div>
          <button type="button" onClick={() => setShowAddAdmin(true)}
            style={{ background: "transparent", border: "none", color: THEME.primary, cursor: "pointer", fontSize: 12, padding: 0, fontWeight: 600 }}>
            + Add admin
          </button>
        </div>
        {admins.length === 0 ? (
          <div style={{ fontSize: 13, color: THEME.gray }}>None yet</div>
        ) : (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: THEME.inkMuted }}>
            {admins.map((a) => (
              <li key={a.id} style={{ marginBottom: 2 }}>
                <b>{a.name || a.email}</b>
                {a.email && <span style={{ color: THEME.gray }}> · {a.email}</span>}
                {a.role === "subAdmin" && (
                  <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: THEME.primaryLight, color: THEME.primaryDark }}>
                    sub
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showAddAdmin && (
        <AddAdminModal org={org} onClose={() => setShowAddAdmin(false)} onToast={onToast} />
      )}
      {deleteOpen && (
        <ConfirmDialog
          title="Delete organization"
          message={
            <>
              Permanently delete <b>{org.name}</b>?
              {admins.length > 0 && (
                <>
                  <br /><br />
                  <span style={{ color: THEME.danger }}>
                    ⚠ This will also delete {admins.length} linked admin profile{admins.length === 1 ? "" : "s"}.
                  </span>{" "}
                  Their Firebase Auth logins will remain — remove them from the Firebase Console manually.
                </>
              )}
            </>
          }
          confirmLabel="Delete permanently"
          danger
          onConfirm={doDelete}
          onCancel={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}

function MiniStat({ label, value, accent = false }) {
  return (
    <div style={{
      background: accent ? THEME.primaryLight : THEME.bg,
      borderRadius: 6, padding: "6px 10px", fontSize: 12,
      color: accent ? THEME.primaryDark : THEME.inkMuted,
      border: `1px solid ${accent ? THEME.primary : THEME.border}`,
    }}>
      <b>{value}</b> <span style={{ opacity: 0.75 }}>{label}</span>
    </div>
  );
}