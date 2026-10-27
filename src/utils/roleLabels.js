/* =========================================================
   src/utils/roleLabels.js
   Workflow-function roles. Keys ARE the workflow names.
   ========================================================= */

export const GLOBAL_ROLES = [
  "requestor",
  "supplier",
  "verifier",
  "confirmer",
  "initialApprover",
  "finalApprover",
  "subAdmin",
  "admin",
  "superAdmin",
  "viewer",
];

export const ADMIN_ROLES = ["admin", "subAdmin", "superAdmin"];

export const ROLE_GROUPS = {
  workflow: {
    label: "Approval Workflow",
    description: "The five-step request pipeline. Each role hands off to the next.",
    roles: ["requestor", "verifier", "confirmer", "initialApprover", "finalApprover"],
  },
  external: {
    label: "External Parties",
    description: "Suppliers and external observers.",
    roles: ["supplier"],
  },
  admin: {
    label: "Administration",
    description: "Users who manage this organization in the app.",
    roles: ["subAdmin", "admin"],
  },
  readOnly: {
    label: "Read-only",
    description: "Users who can view but not modify requests.",
    roles: ["viewer"],
  },
  platform: {
    label: "Platform",
    description: "Platform-wide roles. Not assignable inside an organization.",
    roles: ["superAdmin"],
  },
};

export const DEFAULT_ROLE_LABELS = {
  requestor: "Requestor",
  supplier: "Supplier",
  verifier: "Verifier",
  confirmer: "Confirmer",
  initialApprover: "Initial Approver",
  finalApprover: "Final Approver",
  subAdmin: "Sub-Admin",
  admin: "Admin",
  superAdmin: "Super Admin",
  viewer: "Viewer",
};

export const ROLE_EXPLANATIONS = {
  requestor:
    "Step 1 — Requestor. Submits new requests for their own work. Can view and track the status of every request they submitted.",
  verifier:
    "Step 2 — Verifier. First reviewer. Checks that the request is legitimate and tied to the correct project, then forwards it to the Confirmer.",
  confirmer:
    "Step 3 — Confirmer. Independently verifies the details of each request (times, task, project). Confirmed requests move on to the Initial Approver.",
  initialApprover:
    "Step 4 — Initial Approver. Reviews the request after the Confirmer and gives the first formal approval. Approved items go to the Final Approver.",
  finalApprover:
    "Step 5 — Final Approver. Grants the final approval. Once approved here, the request is considered complete and counts toward totals and reports.",
  supplier:
    "External party who supplies materials, equipment, or services. Cannot submit requests. Can be assigned to projects and view their own approved reports.",
  subAdmin:
    "Scoped administrator. Manages users and projects limited to the project IDs assigned by the admin. Cannot create admin accounts or change organization-wide settings.",
  admin:
    "Organization owner. Manages users, projects, roles, request approvals, and settings for this organization only. Can promote others to admin and change any role except super admin.",
  superAdmin:
    "Platform-level owner. Can create organizations, suspend or delete tenants, manage global settings, and access every organization. Cannot be assigned from inside an organization.",
  viewer:
    "Read-only access. Can view approved requests and reports for projects they are assigned to, but cannot approve, edit, or submit anything.",
};

export const DEFAULT_ROLE_DESCRIPTIONS_SHORT = {
  requestor: "Step 1 — submits new requests.",
  verifier: "Step 2 — verifies legitimacy and routing.",
  confirmer: "Step 3 — confirms accuracy of each request.",
  initialApprover: "Step 4 — gives the first approval.",
  finalApprover: "Step 5 — gives the final approval.",
  supplier: "External party; view-only access.",
  subAdmin: "Manages only the projects assigned by an admin.",
  admin: "Manages this organization, its users, and its settings.",
  superAdmin: "Manages all organizations on the platform.",
  viewer: "Read-only access to approved reports.",
};

export function isKnownRole(role) {
  return typeof role === "string" && GLOBAL_ROLES.includes(role);
}
export function isAdminRole(role) { return ADMIN_ROLES.includes(role); }

export function roleGroupOf(role) {
  if (!role) return null;
  for (const [groupKey, group] of Object.entries(ROLE_GROUPS)) {
    if (group.roles.includes(role)) return groupKey;
  }
  return null;
}

export function rolesByGroup(allowedRoles) {
  const allow = Array.isArray(allowedRoles) ? new Set(allowedRoles) : null;
  return Object.entries(ROLE_GROUPS)
    .map(([key, group]) => ({
      key,
      label: group.label,
      description: group.description,
      roles: group.roles.filter(
        (r) => GLOBAL_ROLES.includes(r) && (!allow || allow.has(r))
      ),
    }))
    .filter((g) => g.roles.length > 0);
}

export function assignableRoles(actorRole) {
  if (actorRole === "superAdmin") return [...GLOBAL_ROLES];
  if (actorRole === "admin") return GLOBAL_ROLES.filter((r) => r !== "superAdmin");
  if (actorRole === "subAdmin") return GLOBAL_ROLES.filter((r) => !ADMIN_ROLES.includes(r));
  return [];
}

export function resolveRoleLabel(role, orgOverrides) {
  if (!role) return "—";
  const overrides = orgOverrides || {};
  const override = typeof overrides[role] === "string" ? overrides[role].trim() : "";
  if (override) return override;
  return DEFAULT_ROLE_LABELS[role] || role;
}

export function resolveRoleExplanation(role) {
  if (!role) return "No description available.";
  return ROLE_EXPLANATIONS[role] || "No description available for this role.";
}

export function resolveRoleShortDescription(role) {
  if (!role) return "";
  return DEFAULT_ROLE_DESCRIPTIONS_SHORT[role] || "";
}

export function listRolesWithLabels(orgOverrides) {
  return GLOBAL_ROLES.map((key) => ({
    key,
    label: resolveRoleLabel(key, orgOverrides),
    group: roleGroupOf(key),
    short: resolveRoleShortDescription(key),
  }));
}

export const ROLE_ORDER = [...GLOBAL_ROLES];