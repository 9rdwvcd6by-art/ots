import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp, collection } from "firebase/firestore";
import { auth, db, getSecondaryAuth } from "../firebase";

function friendlyRegisterError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Try signing in instead.";
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is not enabled in Firebase Console.";
    case "auth/network-request-failed":
      return "Network error. Check your connection and try again.";
    default:
      return err?.message || "Registration failed. Please try again.";
  }
}

export default function RegisterOrganization({ onBackToLogin }) {
  const [form, setForm] = useState({
    orgName: "",
    yourName: "",
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    if (!form.orgName.trim()) return "Please enter an organization name.";
    if (form.orgName.trim().length < 2)
      return "Organization name must be at least 2 characters.";
    if (!form.yourName.trim()) return "Please enter your full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return "Please enter a valid email address.";
    if (form.password.length < 6)
      return "Password must be at least 6 characters.";
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const err = validate();
    if (err) return setError(err);

    setSubmitting(true);
    try {
      const email = form.email.trim().toLowerCase();
      const orgName = form.orgName.trim();
      const yourName = form.yourName.trim();

      /* 1. Create Auth user on the secondary instance */
      const secondaryAuth = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        form.password
      );
      const newUid = cred.user.uid;

      /* 2. Set display name */
      try {
        await updateProfile(cred.user, { displayName: yourName });
      } catch { /* non-fatal */ }

      /* 3. Sign out of secondary auth */
      try {
        await signOut(secondaryAuth);
      } catch { /* ignore */ }

      /* 4. Create the organization */
      const orgRef = doc(collection(db, "organizations"));
      await setDoc(orgRef, {
        name: orgName,
        createdAt: serverTimestamp(),
        createdBy: newUid,
        plan: "trial",
      });

      /* 5. Create the admin profile */
      await setDoc(doc(db, "users", newUid), {
        name: yourName,
        displayName: yourName,
        email,
        role: "admin",
        organizationId: orgRef.id,
        projectIds: [],
        scopedProjectIds: [],
        createdAt: serverTimestamp(),
        createdBy: newUid,
        isSelfRegistered: true,
      });

      /* 6. Sign in on the primary auth — App.jsx picks it up
            automatically via useAuth */
      await signInWithEmailAndPassword(auth, email, form.password);
    } catch (err) {
      setError(friendlyRegisterError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark">OT</div>
        </div>
        <h2>Register Organization</h2>
        <p className="auth-subtitle">
          Create your workspace and become its administrator
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
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="org-name">Organization Name</label>
            <input
              id="org-name"
              type="text"
              value={form.orgName}
              onChange={(e) => setForm({ ...form, orgName: e.target.value })}
              placeholder="e.g. Acme Construction"
              autoComplete="organization"
              required
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="your-name">Your Full Name</label>
            <input
              id="your-name"
              type="text"
              value={form.yourName}
              onChange={(e) => setForm({ ...form, yourName: e.target.value })}
              placeholder="e.g. Ahmed Al-Saud"
              autoComplete="name"
              required
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="you@company.com"
              autoComplete="email"
              required
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="reg-password">Password</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                minLength={6}
                value={form.password}
                onChange={(e) =>
                  setForm({ ...form, password: e.target.value })
                }
                placeholder="At least 6 characters"
                autoComplete="new-password"
                required
                disabled={submitting}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setShowPassword((s) => !s)}
                disabled={submitting}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <PasswordStrength password={form.password} />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting}
            style={{ marginTop: 6 }}
          >
            {submitting ? "Creating your workspace…" : "Create Organization"}
          </button>

          <p className="auth-switch" style={{ marginTop: 16, fontSize: 13 }}>
            Already have an account?{" "}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onBackToLogin?.();
              }}
              style={{ color: "var(--brand-primary)", fontWeight: 600 }}
            >
              Sign in
            </a>
          </p>

          <p
            style={{
              fontSize: 11,
              color: "var(--brand-gray)",
              textAlign: "center",
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            By registering you become the admin of this organization. You can
            invite your team from the dashboard after sign-in.
          </p>
        </form>
      </div>
    </div>
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