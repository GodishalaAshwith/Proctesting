/**
 * auditLogger.js
 * Utility to create audit log entries from route handlers.
 * Usage:
 *   import { logAction } from "../utils/auditLogger.js";
 *   await logAction(req, { action: "CREATE_EXAM", resource: "Exam", resourceId: exam._id });
 */
import AuditLog from "../models/AuditLog.js";

export const logAction = async (req, { action, resource, resourceId, meta }) => {
  try {
    await AuditLog.create({
      actorId: req.user?.id,
      actorRole: req.user?.role,
      actorName: req.user?.name || req.user?.email || "unknown",
      tenantId: req.user?.tenantId || req.tenantId || null,
      action,
      resource,
      resourceId: resourceId || null,
      meta: meta || null,
      ipAddress: req.ip || req.headers["x-forwarded-for"],
      userAgent: req.headers["user-agent"],
    });
  } catch (err) {
    // Never throw — logging should never break the main flow
    console.error("[AuditLog Error]", err.message);
  }
};