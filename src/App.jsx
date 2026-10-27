import { useState, useEffect, useCallback, useMemo } from "react";
import {
  signInWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from "firebase/auth";
import { auth } from "./firebase";
import { useAuth } from "./hooks/useAuth";
import { useRoleLabels } from "./hooks/useRoleLabels";
import { OrgProvider } from "./context/OrgContext";
import RequestorForm from "./components/RequestorForm";
import VerifierApproval from "./components/VerifierApproval";
import ConfirmerReview from "./components/ConfirmerReview";
import InitialApproverApprove from "./components/InitialApproverApprove";
import FinalApproverApprove from "./components/FinalApproverApprove";
import AdminDashboard from "./components/AdminDashboard";
import SuperAdminDashboard from "./components/SuperAdminDashboard";
import RegisterOrganization from "./components/RegisterOrganization";
import { isKnownRole } from "./utils/roleLabels";

const AUTH_ERROR_MAP = {
  "auth/invalid-email": "That email address is not valid.",
  "auth/user-disabled": "This account has been disabled. Contact your administrator.",
  "auth/user-not-found": "Incorrect email or password.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/too-many-requests": "Too many failed attempts. Please wait and try again.",
  "auth/network-request-failed": "Network error. Check your connection.",
  "auth/missing-email": "Please enter your email address first.",
};

function friendlyAuthError(err) {
  const code = err?.code || "";
  return AUTH_ERROR_MAP[code] || err?.message || "Sign-in failed. Please try again.";
}

const REMEMBERED_EMAIL_KEY = "ot:lastEmail";
function loadRememberedEmail() {
  try { return localStorage.getItem(REMEMBERED_EMAIL_KEY) || ""; } catch { return ""; }
}
function saveRememberedEmail(email) {
  try { if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email); } catch {}
}
function isOrgSuspended(organization) {
  if (!organization) return false;
  const s = (organization.status || "").toLowerCase();
  return s === "suspended" || s === "disabled";
}

function LoginScreen({ onGoRegister }) {
  const [email, setEmail] = useState(() => loadRememberedEmail());
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [remember, setRemember] = useState(() => Boolean(loadRememberedEmail()));
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  const cooldownSeconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const lockedOut = cooldownSeconds > 0;

  const handleLogin = async (e) => {
    e.preventDefault();
    if (lockedOut) return;
    setError(""); setInfo(""); setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (remember) saveRememberedEmail(email.trim());
    } catch (err) {
      if ((err?.code || "") === "auth/too-many-requests") {
        setCooldownUntil(Date.now() + 60_000);
      }
      setError(friendlyAuthError(err));
      setPassword("");
    } finally { setSigningIn(false); }
  };

  const handleForgotPassword = async () => {
    if (resetting) return;
    setError(""); setInfo("");
    if (!email.trim()) {
      setError('Enter your email above first, then click "Forgot password".');
      return;
    }
    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo("Password reset email sent. Check your inbox (and spam) for the link.");
    } catch (err) { setError(friendlyAuthError(err)); }
    finally { setResetting(false); }
  };

  const onPasswordKey = (e) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo"><div className="auth-logo-mark">OT</div></div>
        <h2>Overtime System</h2>
        <p className="auth-subtitle">Request and approve overtime</p>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input id="login-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} autoComplete="email"
              required autoFocus disabled={signingIn} />
          </div>
          <div className="form-group">
            <label htmlFor="login-pass">Password</label>
            <div style={{ position: "relative" }}>
              <input id="login-pass" type={showPassword ? "text" : "password"} value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyUp={onPasswordKey} onKeyDown={onPasswordKey}
                autoComplete="current-password" required disabled={signingIn}
                style={{ paddingRight: 44 }} />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  background: "transparent", border: "none", cursor: "pointer",
                  fontSize: 16, color: "var(--brand-gray)", padding: 6 }}>
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
            {capsLock && (
              <div style={{ fontSize: 11, color: "var(--brand-gray)", marginTop: 4 }}>
                ⚠ Caps Lock is on
              </div>
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--brand-gray)", marginBottom: 12 }}>
            <input type="checkbox" checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
                if (!e.target.checked) { try { localStorage.removeItem(REMEMBERED_EMAIL_KEY); } catch {} }
              }}
              disabled={signingIn} />
            Remember my email on this device
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={signingIn || lockedOut}>
            {lockedOut ? `Please wait ${cooldownSeconds}s…` : signingIn ? "Signing in…" : "Sign In"}
          </button>
          {error && <div className="error-msg" role="alert">{error}</div>}
          {info && (
            <div className="error-msg" role="status"
              style={{ background: "var(--brand-primary-light)", color: "var(--brand-primary-dark)" }}>
              {info}
            </div>
          )}
          <p className="auth-switch" style={{ marginTop: 14, fontSize: 12 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); handleForgotPassword(); }}
              style={{ opacity: resetting ? 0.6 : 1 }}>
              {resetting ? "Sending…" : "Forgot password?"}
            </a>
          </p>
          <p className="auth-switch" style={{ marginTop: 14, fontSize: 13 }}>
            <a href="#" onClick={(e) => { e.preventDefault(); onGoRegister(); }}
              style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
              Register a new organization →
            </a>
          </p>
          <p className="auth-switch" style={{ marginTop: 8, fontSize: 12, color: "var(--brand-gray)" }}>
            No account? Ask your administrator to create one for you.
          </p>
        </form>
      </div>
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ minHeight: 260 }}>
        <div className="auth-logo"><div className="auth-logo-mark">OT</div></div>
        <div style={{ height: 22, width: "60%", background: "var(--brand-border)", borderRadius: 6, margin: "0 auto 10px", opacity: 0.5 }} />
        <div style={{ height: 14, width: "40%", background: "var(--brand-border)", borderRadius: 6, margin: "0 auto 24px", opacity: 0.4 }} />
        <div style={{ height: 40, background: "var(--brand-border)", borderRadius: 6, marginBottom: 10, opacity: 0.35 }} />
        <div style={{ height: 40, background: "var(--brand-border)", borderRadius: 6, marginBottom: 14, opacity: 0.35 }} />
        <div style={{ height: 42, background: "var(--brand-primary-light)", borderRadius: 6, opacity: 0.6 }} />
      </div>
    </div>
  );
}

function BlockedCard({ title, subtitle, signedInEmail, onSignOut, extra }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div className="auth-logo"><div className="auth-logo-mark">OT</div></div>
        <h2>{title}</h2>
        <p className="auth-subtitle">{subtitle}</p>
        {signedInEmail && (
          <p style={{ fontSize: 12, color: "var(--brand-gray)", marginTop: 0 }}>
            Signed in as <b>{signedInEmail}</b>
          </p>
        )}
        {extra}
        <button className="btn btn-outline btn-block" onClick={onSignOut} style={{ marginTop: 12 }}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { user, role, organizationId, organization, loading } = useAuth();
  const [mobileTab, setMobileTab] = useState("main");
  const [scopeIds, setScopeIds] = useState([]);
  const [view, setView] = useState("login");

  useEffect(() => { setMobileTab("main"); }, [role]);
  useEffect(() => { if (user) setView("login"); }, [user]);

  useEffect(() => {
    let cancelled = false;
    if (!user || role !== "subAdmin") { setScopeIds([]); return; }
    (async () => {
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const { db } = await import("./firebase");
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : {};
        setScopeIds(Array.isArray(data.scopedProjectIds) ? data.scopedProjectIds : []);
      } catch { if (!cancelled) setScopeIds([]); }
    })();
    return () => { cancelled = true; };
  }, [user, role]);

  const handleSignOut = useCallback(() => signOut(auth), []);

  const orgValue = useMemo(
    () => (role === "superAdmin"
      ? { user, role, organizationId: null, organization: null }
      : { user, role, organizationId, organization }),
    [user, role, organizationId, organization]
  );

  if (loading) return <BootSkeleton />;
  if (!user) {
    return view === "register"
      ? <RegisterOrganization onBackToLogin={() => setView("login")} />
      : <LoginScreen onGoRegister={() => setView("register")} />;
  }
  if (!role) {
    return (
      <BlockedCard title="Account not ready"
        subtitle="Your account is not yet assigned a role. Please contact the platform administrator."
        signedInEmail={user.email} onSignOut={handleSignOut} />
    );
  }
  if (!isKnownRole(role)) {
    return (
      <BlockedCard title="Role not recognized"
        subtitle={`This account has a role ("${role}") that is no longer supported. Please contact your administrator to have it corrected.`}
        signedInEmail={user.email} onSignOut={handleSignOut} />
    );
  }
  if (role === "superAdmin") {
    return <OrgProvider value={orgValue}><SuperAdminDashboard /></OrgProvider>;
  }
  if (isOrgSuspended(organization)) {
    return (
      <BlockedCard title="Organization suspended"
        subtitle="Access to this workspace has been suspended by the platform administrator. Please contact your administrator if you believe this is an error."
        signedInEmail={user.email} onSignOut={handleSignOut}
        extra={organization?.name && (
          <p style={{ fontSize: 13, marginTop: 8 }}>Organization: <b>{organization.name}</b></p>
        )} />
    );
  }
  if (!organizationId) {
    return (
      <BlockedCard title="No organization assigned"
        subtitle="Your account isn't assigned to an organization yet. Please contact the platform administrator."
        signedInEmail={user.email} onSignOut={handleSignOut} />
    );
  }
  if (role === "admin" || role === "subAdmin") {
    return <OrgProvider value={orgValue}><AdminDashboard /></OrgProvider>;
  }

  return (
    <OrgProvider value={orgValue}>
      <RegularShell
        user={user}
        role={role}
        organization={organization}
        organizationId={organizationId}
        scopeIds={scopeIds}
        mobileTab={mobileTab}
        setMobileTab={setMobileTab}
      />
    </OrgProvider>
  );
}

function RegularShell({ user, role, organization, organizationId, scopeIds, mobileTab, setMobileTab }) {
  const { label: roleLabelOf } = useRoleLabels();
  const roleLabel = roleLabelOf(role);
  const suspended = isOrgSuspended(organization);

  const workflowView = (() => {
    switch (role) {
      case "requestor":       return <RequestorForm />;
      case "verifier":        return <VerifierApproval />;
      case "confirmer":       return <ConfirmerReview />;
      case "initialApprover": return <InitialApproverApprove />;
      case "finalApprover":   return <FinalApproverApprove />;
      default:                return null;
    }
  })();
  const isReadOnlyRole = role === "supplier" || role === "viewer";

  return (
    <>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">OT</div>
          <h1>{mobileTab === "profile" ? "My Profile" : organization?.name || "Overtime System"}</h1>
        </div>
        <div className="header-actions">
          <span className="role-pill">{roleLabel}</span>
          <button className="btn-logout" onClick={() => signOut(auth)}>Sign Out</button>
        </div>
      </header>

      {suspended && (
        <div style={{ background: "#FBEBC7", color: "#7A4A0E", fontSize: 12, padding: "8px 14px", textAlign: "center" }}>
          ⚠ This organization is suspended. Please contact your administrator.
        </div>
      )}

      <main className="app-main">
        {mobileTab === "profile" ? (
          <ProfileTab user={user} role={role} roleLabel={roleLabel}
            organization={organization} organizationId={organizationId} scopeIds={scopeIds} />
        ) : workflowView ? (
          workflowView
        ) : isReadOnlyRole ? (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <h3 style={{ marginTop: 0 }}>Read-only access</h3>
            <p style={{ fontSize: 13, color: "var(--brand-gray)", margin: 0 }}>
              Your role ({roleLabel}) gives you view-only access to this organization.
              To see approved requests, ask an administrator to include you on a project.
            </p>
          </div>
        ) : (
          <div className="card" style={{ textAlign: "center", padding: 40 }}>
            <h3 style={{ marginTop: 0 }}>Nothing to do here</h3>
            <p style={{ fontSize: 13, color: "var(--brand-gray)", margin: 0 }}>
              Your role ({roleLabel}) doesn&apos;t have an assigned workspace.
              Please contact your administrator if you think this is wrong.
            </p>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        <button className={`nav-item ${mobileTab === "main" ? "active" : ""}`} onClick={() => setMobileTab("main")}>
          <span className="nav-icon">🏠</span><span>Home</span>
        </button>
        <button className={`nav-item ${mobileTab === "profile" ? "active" : ""}`} onClick={() => setMobileTab("profile")}>
          <span className="nav-icon">👤</span><span>Profile</span>
        </button>
      </nav>
    </>
  );
}

function ProfileTab({ user, role, roleLabel, organization, organizationId, scopeIds }) {
  const displayEmail = user?.email || "—";
  const displayName = user?.displayName || displayEmail;
  const initial = (displayName[0] || "?").toUpperCase();
  const isSubAdmin = role === "subAdmin";
  const scope = Array.isArray(scopeIds) ? scopeIds : [];
  const suspended = isOrgSuspended(organization);

  const [copied, setCopied] = useState(false);
  const copyUid = async () => {
    try {
      await navigator.clipboard.writeText(user?.uid || "");
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const lastSignIn = user?.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : "—";

  return (
    <>
      <div className="card">
        <h3>My Profile</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-primary-dark) 100%)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, fontWeight: 800, flexShrink: 0 }}>
            {initial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brand-ink)" }}>{displayName}</div>
            <div style={{ fontSize: 13, color: "var(--brand-gray)" }}>{displayEmail}</div>
          </div>
        </div>

        <table className="detail-table">
          <tbody>
            <tr><th>Role</th><td>{roleLabel}</td></tr>
            <tr>
              <th>Organization</th>
              <td>
                {organization?.name || organizationId}
                {suspended && (
                  <span style={{ marginLeft: 8, fontSize: 11, padding: "1px 6px",
                    borderRadius: 999, background: "#FBEBC7", color: "#7A4A0E" }}>
                    Suspended
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <th>User ID</th>
              <td style={{ fontSize: 12, wordBreak: "break-all" }}>
                {user?.uid || "—"}{" "}
                <button type="button" onClick={copyUid}
                  style={{ background: "transparent", border: "none", cursor: "pointer",
                    color: "var(--brand-primary)", fontSize: 11, padding: 0, marginLeft: 4 }}>
                  {copied ? "copied ✓" : "copy"}
                </button>
              </td>
            </tr>
            <tr><th>Last sign-in</th><td>{lastSignIn}</td></tr>
            {isSubAdmin && (
              <tr>
                <th>Scoped Projects</th>
                <td>
                  {scope.length === 0
                    ? <span style={{ color: "var(--brand-gray)" }}>None</span>
                    : <span><b>{scope.length}</b> {scope.length === 1 ? "project" : "projects"}</span>}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ fontSize: 12, color: "var(--brand-gray)", marginTop: 16, marginBottom: 0 }}>
          {isSubAdmin
            ? "Your scope and role are managed by the platform administrator."
            : "Your profile and role are managed by an administrator."}
        </p>
      </div>

      <div className="card">
        <h3>Account</h3>
        <button type="button" className="btn btn-outline btn-block" onClick={() => signOut(auth)}
          style={{ color: "var(--brand-danger)", borderColor: "var(--brand-danger)" }}>
          Sign Out
        </button>
      </div>
    </>
  );
}