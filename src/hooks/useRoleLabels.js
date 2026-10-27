import { useEffect, useState, useMemo, useCallback } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import { useOrg } from "../context/OrgContext";
import { DEFAULT_ROLE_LABELS, resolveRoleLabel } from "../utils/roleLabels";

export function useRoleLabels() {
  const { organizationId } = useOrg();
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) { setOverrides({}); setLoading(false); return; }
    const unsub = onSnapshot(
      doc(db, "organizations", organizationId),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        setOverrides(data.roleLabels || {});
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [organizationId]);

  const label = useCallback(
    (role) => resolveRoleLabel(role, overrides),
    [overrides]
  );

  const saveLabels = useCallback(
    async (next) => {
      if (!organizationId) throw new Error("No organization in scope.");
      await setDoc(
        doc(db, "organizations", organizationId),
        { roleLabels: next },
        { merge: true }
      );
    },
    [organizationId]
  );

  return useMemo(
    () => ({ label, labels: overrides, defaults: DEFAULT_ROLE_LABELS, saveLabels, loading }),
    [label, overrides, saveLabels, loading]
  );
}