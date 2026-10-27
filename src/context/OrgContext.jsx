import { createContext, useContext } from "react";

const OrgContext = createContext({
  organizationId: null,
  organization: null,
  role: null,
  user: null,
});

export function OrgProvider({ value, children }) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx.organizationId) {
    throw new Error("useOrg must be used within a signed-in user with an organizationId");
  }
  return ctx;
}