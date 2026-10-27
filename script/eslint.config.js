/* eslint-disable no-console */
const admin = require("firebase-admin");
const sa = require("./service-account-key.json");
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const ROLE_MAP = {
  contractor: "requestor",
  projectEngineer: "verifier",
  inspector: "confirmer",
  supervisor: "initialApprover",
  manager: "finalApprover",
};
const STATUS_MAP = {
  pending_engineer: "pending_verifier",
  pending_inspector: "pending_confirmer",
  pending_supervisor: "pending_initial_approver",
  rejected: "rejected_confirmer",
  rejected_engineer: "rejected_verifier",
  rejected_supervisor: "rejected_initial_approver",
  rejected_manager: "rejected_final_approver",
  pending_supervisor_internal: "pending_initial_approver_internal",
  pending_manager: "pending_final_approver_internal",
  approved_manager: "approved_final_approver",
  withdrawn_internal: "withdrawn_internal",
  approved: "approved",
};
const FIELD_MAP = {
  contractorId: "requestorId", contractorName: "requestorName", contractorEmail: "requestorEmail",
  projectEngineerId: "verifierId", engineerEmail: "verifierEmail",
  inspectorId: "confirmerId", inspectorEmail: "confirmerEmail",
  supervisorId: "initialApproverId", supervisorEmail: "initialApproverEmail",
  managerId: "finalApproverId", managerEmail: "finalApproverEmail",
};

function remap(obj) {
  const p = {};
  for (const [o, n] of Object.entries(FIELD_MAP)) {
    if (o in obj && n !== o && !(n in obj)) {
      p[n] = obj[o]; p[o] = admin.firestore.FieldValue.delete();
    }
  }
  return p;
}

async function run() {
  for (const col of ["users", "projects", "overtime_requests"]) {
    const snap = await db.collection(col).get();
    console.log(`[${col}] ${snap.size} docs`);
    let batch = db.batch(), count = 0, touched = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      const patch = remap(data);
      if (data.role && ROLE_MAP[data.role]) patch.role = ROLE_MAP[data.role];
      if (data.status && STATUS_MAP[data.status]) patch.status = STATUS_MAP[data.status];
      if (Object.keys(patch).length === 0) continue;
      batch.update(doc.ref, patch);
      touched++;
      if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`[${col}] migrated ${touched} docs`);
  }
}
run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });