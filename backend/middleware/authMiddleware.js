/**
 * UPDATED authMiddleware.js — Multi-Tenant Version
 *
 * Changes from original:
 *  - JWT now carries tenantId
 *  - New middleware: requireTenantMatch (prevents cross-tenant access)
 *  - New middleware: resolveTenant (reads subdomain from Host header)
 *  - requireRole kept as-is (backward compatible)
 */
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import Tenant from "../models/Tenant.js";

dotenv.config();

// ─── 1. Core Auth Middleware ─────────────────────────────────────────────────
const auth = (req, res, next) => {
  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : header;

  if (!token)
    return res.status(401).json({ msg: "No token, authorization denied" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // decoded: { id, role, tenantId, model, iat, exp }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ msg: "Invalid token" });
  }
};

// ─── 2. Role-Based Access Control ───────────────────────────────────────────
const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ msg: "Forbidden: insufficient role" });
    }
    next();
  };

// ─── 3. Tenant Isolation Enforcement ────────────────────────────────────────
// Use this on any route that operates within a tenant context.
// Ensures the JWT's tenantId matches the route param :tenantId (if present)
// OR that the user's tenantId is injected into req.tenantId for query filtering.
const requireTenantAccess = (req, res, next) => {
  // Superadmin can access any tenant
  if (req.user?.role === "superadmin") return next();

  const userTenantId = req.user?.tenantId;
  if (!userTenantId) {
    return res.status(403).json({ msg: "No tenant associated with this account" });
  }

  // If route has :tenantId param, enforce match
  if (req.params.tenantId && req.params.tenantId !== userTenantId) {
    return res.status(403).json({ msg: "Cross-tenant access denied" });
  }

  // Inject tenantId so route handlers can safely use req.tenantId
  req.tenantId = userTenantId;
  next();
};

// ─── 4. Subdomain-Based Tenant Resolution ────────────────────────────────────
// Reads the Host header, extracts subdomain, loads tenant from DB.
// Result is attached to req.tenant (can be null for platform root).
const resolveTenant = async (req, res, next) => {
  try {
    const host = req.headers.host || "";
    const parts = host.split(".");
    // e.g. "cbit.yourplatform.com" → parts = ["cbit", "yourplatform", "com"]
    // Root domain "yourplatform.com" or "localhost" → no subdomain
    if (parts.length > 2) {
      const subdomain = parts[0].toLowerCase();
      const tenant = await Tenant.findOne({ subdomain, status: "active" }).lean();
      if (!tenant) {
        return res.status(404).json({ msg: `Tenant '${subdomain}' not found or inactive` });
      }
      req.tenant = tenant;
      req.tenantId = String(tenant._id);
    } else {
      req.tenant = null; // Platform root — superadmin context
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: "Tenant resolution failed" });
  }
};

// ─── 5. Tenant Status Guard ───────────────────────────────────────────────────
// Ensure the tenant in JWT is still active before allowing any action.
const requireActiveTenant = async (req, res, next) => {
  if (req.user?.role === "superadmin") return next();

  try {
    const tenant = await Tenant.findById(req.user?.tenantId).select("status name").lean();
    if (!tenant) {
      return res.status(404).json({ msg: "Tenant not found" });
    }
    if (tenant.status !== "active") {
      return res.status(403).json({
        msg: `Your organization '${tenant.name}' has been ${tenant.status}. Contact the platform administrator.`,
      });
    }
    req.tenantId = String(tenant._id);
    next();
  } catch (err) {
    return res.status(500).json({ error: "Tenant validation failed" });
  }
};

// Backward-compatible export
auth.requireRole = requireRole;
auth.requireTenantAccess = requireTenantAccess;
auth.resolveTenant = resolveTenant;
auth.requireActiveTenant = requireActiveTenant;

export default auth;