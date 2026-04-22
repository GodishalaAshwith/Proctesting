/**
 * superadmin.routes.js
 * All routes require: authenticated superadmin
 *
 * POST   /api/superadmin/tenants          — Create tenant + auto TenantAdmin
 * GET    /api/superadmin/tenants          — List all tenants
 * GET    /api/superadmin/tenants/:id      — Get tenant details
 * PATCH  /api/superadmin/tenants/:id      — Update tenant (status, plan, branding)
 * DELETE /api/superadmin/tenants/:id      — Soft-disable tenant
 * GET    /api/superadmin/audit-logs       — Platform-wide audit logs
 * GET    /api/superadmin/stats            — Platform analytics
 */
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Tenant from "../models/Tenant.js";
import User from "../models/User.js";
import SuperAdmin from "../models/SuperAdmin.js";
import AuditLog from "../models/AuditLog.js";
import auth from "../middleware/authMiddleware.js";
import {
  generateTenantCode,
  generatePassword,
  hashPassword,
  nameToSubdomain,
} from "../utils/tenantUtils.js";
import { logAction } from "../utils/auditLogger.js";

const router = express.Router();

// All routes require superadmin role
const SA = [auth, auth.requireRole("superadmin")];

// ─── Login for SuperAdmin ─────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await SuperAdmin.findOne({ email: email?.trim() });
    if (!admin) return res.status(401).json({ msg: "Invalid credentials" });

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) return res.status(401).json({ msg: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, role: "superadmin", email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ token, user: { id: admin._id, name: admin.name, email: admin.email, role: "superadmin" } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Create Tenant ────────────────────────────────────────────────────────────
router.post("/tenants", ...SA, async (req, res) => {
  try {
    const {
      name, contactEmail, contactPhone, address,
      plan, maxStudents, maxFaculty, maxExams,
      branding, subdomain: customSubdomain,
    } = req.body;

    if (!name || !contactEmail) {
      return res.status(400).json({ msg: "name and contactEmail are required" });
    }

    const subdomain = customSubdomain
      ? customSubdomain.toLowerCase().trim()
      : nameToSubdomain(name);

    // Ensure subdomain is not taken
    const exists = await Tenant.findOne({ subdomain });
    if (exists) {
      return res.status(409).json({ msg: `Subdomain '${subdomain}' is already taken` });
    }

    const tenantCode = generateTenantCode(name);

    // Create the Tenant
    const tenant = await Tenant.create({
      tenantCode,
      name,
      subdomain,
      contactEmail,
      contactPhone,
      address,
      plan: plan || "free",
      maxStudents: maxStudents || 500,
      maxFaculty: maxFaculty || 20,
      maxExams: maxExams || 50,
      branding: branding || {},
      createdBy: req.user.id,
    });

    // Auto-generate TenantAdmin credentials
    const adminEmail = `admin@${subdomain}.local`;
    const rawPassword = generatePassword();
    const hashedPw = await hashPassword(rawPassword);

    const tenantAdmin = await User.create({
      name: `Admin - ${name}`,
      email: adminEmail,
      password: hashedPw,
      role: "tenantAdmin",
      tenantId: tenant._id,
      systemGenerated: true,
      mustChangePassword: true,
    });

    await logAction(req, {
      action: "CREATE_TENANT",
      resource: "Tenant",
      resourceId: tenant._id,
      meta: { tenantCode, subdomain, adminEmail },
    });

    return res.status(201).json({
      tenant: {
        id: tenant._id,
        tenantCode,
        name: tenant.name,
        subdomain: tenant.subdomain,
        plan: tenant.plan,
        status: tenant.status,
      },
      tenantAdminCredentials: {
        // Return raw password ONCE — it won't be retrievable again
        email: adminEmail,
        password: rawPassword,
        userId: tenantAdmin._id,
        note: "Store these credentials securely. Password is shown only once.",
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── List All Tenants ─────────────────────────────────────────────────────────
router.get("/tenants", ...SA, async (req, res) => {
  try {
    const { status, plan, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (plan) filter.plan = plan;
    if (search) filter.name = { $regex: search, $options: "i" };

    const tenants = await Tenant.find(filter)
      .sort({ createdAt: -1 })
      .select("-__v")
      .lean();

    // Enrich with basic stats
    const enriched = await Promise.all(
      tenants.map(async (t) => {
        const [studentCount, facultyCount, examCount] = await Promise.all([
          User.countDocuments({ tenantId: t._id, role: { $in: ["student"] } }),
          User.countDocuments({ tenantId: t._id, role: "faculty" }),
          (await import("../models/Exam.js")).default.countDocuments({ tenantId: t._id }),
        ]);
        return { ...t, stats: { studentCount, facultyCount, examCount } };
      })
    );

    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Get Single Tenant ────────────────────────────────────────────────────────
router.get("/tenants/:id", ...SA, async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).lean();
    if (!tenant) return res.status(404).json({ msg: "Tenant not found" });

    const [admins, faculty] = await Promise.all([
      User.find({ tenantId: tenant._id, role: "tenantAdmin" }).select("name email createdAt mustChangePassword").lean(),
      User.find({ tenantId: tenant._id, role: "faculty" }).select("name email createdAt").lean(),
    ]);

    return res.json({ ...tenant, admins, faculty });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Update Tenant (status, branding, plan) ────────────────────────────────
router.patch("/tenants/:id", ...SA, async (req, res) => {
  try {
    const { status, plan, branding, maxStudents, maxFaculty, maxExams, disabledReason } = req.body;
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ msg: "Tenant not found" });

    const prevStatus = tenant.status;
    if (status) tenant.status = status;
    if (plan) tenant.plan = plan;
    if (maxStudents) tenant.maxStudents = maxStudents;
    if (maxFaculty) tenant.maxFaculty = maxFaculty;
    if (maxExams) tenant.maxExams = maxExams;
    if (branding) tenant.branding = { ...tenant.branding, ...branding };
    if (status === "disabled") {
      tenant.disabledAt = new Date();
      tenant.disabledReason = disabledReason || "";
    }

    await tenant.save();

    await logAction(req, {
      action: "UPDATE_TENANT",
      resource: "Tenant",
      resourceId: tenant._id,
      meta: { prevStatus, newStatus: status, plan },
    });

    return res.json({ msg: "Tenant updated", tenant });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Platform-Wide Audit Logs ─────────────────────────────────────────────────
router.get("/audit-logs", ...SA, async (req, res) => {
  try {
    const { tenantId, action, actorId, from, to, limit = 100, page = 1 } = req.query;
    const filter = {};
    if (tenantId) filter.tenantId = tenantId;
    if (action) filter.action = { $regex: action, $options: "i" };
    if (actorId) filter.actorId = actorId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    return res.json({ total, page: Number(page), logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── Platform Stats ───────────────────────────────────────────────────────────
router.get("/stats", ...SA, async (req, res) => {
  try {
    const [totalTenants, activeTenants, disabledTenants, totalFaculty] = await Promise.all([
      Tenant.countDocuments(),
      Tenant.countDocuments({ status: "active" }),
      Tenant.countDocuments({ status: "disabled" }),
      User.countDocuments({ role: "faculty" }),
    ]);

    // Dynamic imports to avoid circular deps
    const Exam = (await import("../models/Exam.js")).default;
    const Attempt = (await import("../models/Attempt.js")).default;
    const Student = (await import("../models/Student.js")).default;

    const [totalExams, totalAttempts, totalStudents] = await Promise.all([
      Exam.countDocuments(),
      Attempt.countDocuments(),
      Student.countDocuments(),
    ]);

    return res.json({
      tenants: { total: totalTenants, active: activeTenants, disabled: disabledTenants },
      users: { faculty: totalFaculty, students: totalStudents },
      activity: { exams: totalExams, attempts: totalAttempts },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;