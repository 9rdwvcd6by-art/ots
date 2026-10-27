import { useState, useMemo, useCallback } from "react";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth, getSecondaryAuth } from "../firebase";
import { useOrg } from "../context/OrgContext";
import { useRoleLabels } from "../hooks/useRoleLabels";

export default function SubAdminRegister({ projects, onSuccess, onCancel }) {
  const { organizationId } = useOrg();
  const { label: roleLabelOf } = useRoleLabels();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    projectIds: [],
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  /* ---------- Project list (filtered by search) ---------- */
  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.location || "").toLowerCase().includes(q)
    );
  }, [projects, search]);

  const allVisibleSelected =
    visibleProjects.length > 0 &&
    visibleProjects.every((p) => form.projectIds.includes(p.id));

  const toggleProject = useCallback((id) => {
    setForm((f) => ({
      ...f,
      projectIds: f.projectIds.includes(id)
        ? f.projectIds.filter((x) => x !== id)
        : [...f.projectIds, id],
    }));
  }, []);

  const selectAllVisible = () => {
    setForm((f) => {
      const next = new Set(f.projectIds);
      visibleProjects.forEach((p) => next.add(p.id));
      return { ...f, projectIds: Array.from(next) };
    });
  };

  const clearAll = () => setForm((f) => ({ ...f, projectIds: [] }));

  const validate = () => {
    if (!form.name.trim()) return "Please enter a full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return "Please enter a valid email address.";
    if (form.password.length < 6)
      return "Temporary password must be at least 6 characters.";
    if (form.projectIds.length === 0)
      return "Please assign at least one project to this Sub-Admin.";
    return null;
  };

  /* ---------- Submit ---------- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const err = validate();
    if (err) return setError(err);

    setSubmitting(true);
    try {
      const email = form.email.trim().toLowerCase();

      // 1) Create the Firebase Auth account on the secondary auth instance
      //    so the current admin is not signed out.
      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        form.password
      );
      const newUid = cred.user.uid;
      try {
        await signOut(secondaryAuth);
      } catch {
        /* ignore */
      }

      // 2) Create the Firestore profile with subAdmin role + scoped projects
      try {
        await setDoc(doc(db, "users", newUid), {
          name: form.name.trim(),
          displayName: form.name.trim(),
          email,
          role: "subAdmin",
          organizationId,
          scopedProjectIds: form.projectIds,
          projectIds: form.projectIds,   // mirror for legacy queries
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: auth.currentUser?.uid || null,
          isSubAdmin: true,
        });
      } catch (profileErr) {
        // Auth account was created but profile write failed.
        // Better to surface this than silently say "done".
        throw new Error(
          `Auth account created (${email}), but the Firestore profile failed: ${profileErr.message}.\n\n` +
            `Ask the admin to delete the Auth user in Firebase Console and try again.`
        );
      }

      // 3) Done
      onSuccess?.();
    } catch (err) {
      const code = err.code || "";
      let msg = err.message;
      if (code === "auth/email-already-in-use")
        msg = "That email is already registered.";
      else if (code === "auth/invalid-email") msg = "Invalid email.";
      else if (code === "auth/weak-password") msg = "Password is too weak.";
      else if (code === "auth/operation-not-allowed")
        msg = "Email/Password sign-in is not enabled.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- Render ---------- */
  return (
    <form onSubmit={handleSubmit}>
      <h3 style={{ margin: "0 0 6px" }}>
        Register a {roleLabelOf("subAdmin")}
      </h3>
      <p style={{ fontSize: 13, color: "var(--brand-gray)", marginBottom: 20 }}>
        {roleLabelOf("subAdmin")}s can manage users and requests <b>only</b>{" "}
        within the projects you assign to them. They cannot see or edit other
        projects.
      </p>

      {error && (
        <div
          className="error-msg"
          role="alert"
          style={{
            background: "#FEE2E2",
            color: "#991B1B",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 14,
            fontSize: 13,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {/* Basic info */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="sa-name">Full Name</label>
          <input
            id="sa-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Sara Al-Mutairi"
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="sa-email">Email</label>
          <input
            id="sa-email"
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="subadmin@company.com"
            autoComplete="off"
          />
        </div>
      </div>

      {/* Password + Role */}
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="sa-pass">Temporary Password</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="sa-pass"
              required
              type={showPassword ? "text" : "password"}
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              style={{ flex: 1, minWidth: 0 }}
              aria-describedby="sa-pass-strength"
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <PasswordStrength id="sa-pass-strength" password={form.password} />
        </div>
        <div className="form-group">
          <label>Role</label>
          <input
            value={roleLabelOf("subAdmin")}
            disabled
            style={{ background: "var(--brand-bg)", cursor: "not-allowed" }}
          />
        </div>
      </div>

      {/* Project scope */}
      <div className="form-group">
        <label>
          Scope — Projects this {roleLabelOf("subAdmin")} can manage (
          {form.projectIds.length} selected)
        </label>

        <input
          placeholder="Search projects by name, code or location"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--brand-border)",
            borderRadius: 8,
            marginBottom: 8,
            fontFamily: "inherit",
            fontSize: 14,
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 8,
            fontSize: 13,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={selectAllVisible}
            disabled={allVisibleSelected}
          >
            Select all visible ({visibleProjects.length})
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={clearAll}
            disabled={form.projectIds.length === 0}
          >
            Clear
          </button>
          <span style={{ marginLeft: "auto", color: "var(--brand-gray)" }}>
            {form.projectIds.length} of {projects.length} selected
          </span>
        </div>

        {projects.length === 0 && (
          <div className="empty-state" style={{ padding: 16 }}>
            No projects in this organization yet. Create a project first, then
            assign it here.
          </div>
        )}

        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="empty-state" style={{ padding: 16 }}>
            No projects match your search.
          </div>
        )}

        {visibleProjects.length > 0 && (
          <div
            style={{
              border: "1px solid var(--brand-border)",
              borderRadius: 10,
              maxHeight: 260,
              overflowY: "auto",
            }}
          >
            {visibleProjects.map((p, idx) => {
              const checked = form.projectIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom:
                      idx === visibleProjects.length - 1
                        ? "none"
                        : "1px solid var(--brand-border)",
                    cursor: "pointer",
                    background: checked
                      ? "var(--brand-primary-light)"
                      : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProject(p.id)}
                  />
                  <span style={{ flex: 1 }}>
                    <b>{p.code || "—"}</b> · {p.name}
                    {p.location && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 12,
                          color: "var(--brand-gray)",
                        }}
                      >
                        ({p.location})
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="form-actions" style={{ marginTop: 18 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting}
        >
          {submitting
            ? "Registering…"
            : `Register ${roleLabelOf("subAdmin")}`}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
        )}
      </div>

      <p
        style={{
          fontSize: 12,
          color: "var(--brand-gray)",
          marginTop: 12,
          lineHeight: 1.5,
        }}
      >
        The {roleLabelOf("subAdmin")} will sign in with this email and temporary
        password. Share it securely; they can change it via "Forgot password".
      </p>
    </form>
  );
}

/* ---------------- Password Strength ---------------- */
function PasswordStrength({ id, password }) {
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
    <div id={id} style={{ marginTop: 4 }}>
      <div
        style={{
          height: 4,
          background: "#E5E7EB",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${(score / 5) * 100}%`,
            height: "100%",
            background: color,
            transition: "width 150ms ease",
          }}
        />
      </div>
      <div style={{ fontSize: 11, color, marginTop: 2 }}>{label}</div>
    </div>
  );
}