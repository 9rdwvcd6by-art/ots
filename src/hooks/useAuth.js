import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

export function useAuth() {
  const [state, setState] = useState({
    user: null,
    profile: null,        // raw users/{uid} document
    role: null,
    organizationId: null,
    organization: null,
    loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      /* ---- Signed out ---- */
      if (!user) {
        setState({
          user: null,
          profile: null,
          role: null,
          organizationId: null,
          organization: null,
          loading: false,
        });
        return;
      }

      /* ---- Signed in: load profile + organization ---- */
      try {
        const snap = await getDoc(doc(db, "users", user.uid));

        if (!snap.exists()) {
          // Signed in, but no Firestore profile yet
          setState({
            user,
            profile: null,
            role: null,
            organizationId: null,
            organization: null,
            loading: false,
          });
          return;
        }

        const data = snap.data();
        const role = data.role || null;
        const organizationId = data.organizationId || null;

        /* Super-admin has no organization by design — skip the org read. */
        let organization = null;
        if (role !== "superAdmin" && organizationId) {
          try {
            const orgSnap = await getDoc(
              doc(db, "organizations", organizationId)
            );
            organization = orgSnap.exists()
              ? { id: organizationId, ...orgSnap.data() }
              : null;
          } catch (err) {
            // Org doc missing / permission denied — don't block the app
            console.warn("Failed to load organization:", err);
            organization = null;
          }
        }

        setState({
          user,
          profile: { id: user.uid, ...data },
          role,
          organizationId,
          organization,
          loading: false,
        });
      } catch (err) {
        // Firestore failed entirely (offline, rules, etc.)
        console.error("Failed to load user profile:", err);
        setState({
          user,
          profile: null,
          role: null,
          organizationId: null,
          organization: null,
          loading: false,
        });
      }
    });

    return () => unsub();
  }, []);

  return state;
}