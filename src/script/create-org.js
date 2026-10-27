// scripts/create-org.js
// Usage:  node scripts/create-org.js "Acme Corp" admin@acme.com "tempPassword123"

const admin = require("firebase-admin");

// Download a service account key from Firebase Console → Project Settings → Service Accounts
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const [, , orgName, adminEmail, adminPassword] = process.argv;

if (!orgName || !adminEmail || !adminPassword) {
  console.error('Usage: node scripts/create-org.js "<Org Name>" <adminEmail> <adminPassword>');
  process.exit(1);
}

(async () => {
  const db = admin.firestore();
  const authSvc = admin.auth();

  // 1. Create org doc
  const orgRef = db.collection("organizations").doc();
  const orgId = orgRef.id;
  await orgRef.set({
    name: orgName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✔ Organization created: ${orgName} (${orgId})`);

  // 2. Create Firebase Auth user
  const userRecord = await authSvc.createUser({
    email: adminEmail,
    password: adminPassword,
    displayName: orgName + " Admin",
  });
  console.log(`✔ Auth user created: ${adminEmail} (${userRecord.uid})`);

  // 3. Create user profile tied to org
  await db.collection("users").doc(userRecord.uid).set({
    name: orgName + " Admin",
    displayName: orgName + " Admin",
    email: adminEmail,
    role: "admin",
    organizationId: orgId,
    projectIds: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✔ User profile created with role=admin, organizationId=${orgId}`);
  console.log("\nDone. Log in with the admin email/password to start.");

  process.exit(0);
})().catch(err => {
  console.error("✖ Failed:", err);
  process.exit(1);
});