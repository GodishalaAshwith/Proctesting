/**
 * TenantContext.jsx
 * Detects the current tenant from the URL subdomain,
 * fetches branding from the backend, and provides it
 * to the whole app.
 *
 * Subdomain detection:
 *   cbit.yourplatform.com   → subdomain = "cbit"
 *   localhost / root domain → subdomain = null (platform root)
 */
import { createContext, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";

const TenantContext = createContext(null);

/**
 * Reads subdomain from window.location.hostname.
 * Returns null on localhost or root domain.
 */
export const detectSubdomain = () => {
  const hostname = window.location.hostname;
  // localhost, 127.0.0.1, or single-part hostname → no subdomain
  const parts = hostname.split(".");
  if (parts.length <= 2) return null;
  return parts[0].toLowerCase();
};

export const TenantProvider = ({ children }) => {
  const [tenant, setTenant] = useState(null);       // tenant branding object
  const [tenantId, setTenantId] = useState(null);   // tenantId string (from localStorage or resolved)
  const [subdomain, setSubdomain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const sub = detectSubdomain();
    setSubdomain(sub);

    if (!sub) {
      // Platform root — superadmin or direct API access
      setLoading(false);
      return;
    }

    // Fetch tenant branding by subdomain
    const apiBase = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname.split(".").slice(1).join(".")}:5000`;
    const url = `${apiBase}/api/tenant/branding/${sub}`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data?.tenantId) {
          setTenant(data);
          setTenantId(String(data.tenantId));
          // Apply branding CSS variables to document root
          applyBranding(data.branding || {});
        } else {
          setError(`Organization '${sub}' not found or inactive.`);
        }
      })
      .catch(() => setError("Could not reach the server. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, tenantId, subdomain, loading, error }}>
      {children}
    </TenantContext.Provider>
  );
};

TenantProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useTenant = () => useContext(TenantContext);

// ─── Apply CSS variables for white-label branding ────────────────────────────
const applyBranding = (branding = {}) => {
  const root = document.documentElement;
  if (branding.primaryColor) {
    root.style.setProperty("--color-primary", branding.primaryColor);
  }
  if (branding.secondaryColor) {
    root.style.setProperty("--color-secondary", branding.secondaryColor);
  }
  if (branding.logoUrl) {
    // Can be consumed by Navbar: var(--tenant-logo)
    root.style.setProperty("--tenant-logo", `url("${branding.logoUrl}")`);
  }
};