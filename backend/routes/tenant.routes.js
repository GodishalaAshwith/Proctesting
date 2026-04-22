/**
 * tenant.routes.js
 * Public routes — no auth required.
 * Used by the frontend TenantContext to resolve branding by subdomain.
 *
 * GET /api/tenant/branding/:subdomain
 */
import express from "express";
import Tenant from "../models/Tenant.js";

const router = express.Router();

// Public: resolve tenant branding by subdomain
router.get("/branding/:subdomain", async (req, res) => {
  try {
    const subdomain = req.params.subdomain?.toLowerCase().trim();
    if (!subdomain) return res.status(400).json({ msg: "Subdomain required" });

    const tenant = await Tenant.findOne({ subdomain, status: "active" })
      .select("_id name subdomain tenantCode branding plan")
      .lean();

    if (!tenant) {
      return res.status(404).json({ msg: `Organization '${subdomain}' not found or inactive` });
    }

    return res.json({
      tenantId: tenant._id,
      tenantCode: tenant.tenantCode,
      name: tenant.name,
      subdomain: tenant.subdomain,
      plan: tenant.plan,
      branding: tenant.branding || {},
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;