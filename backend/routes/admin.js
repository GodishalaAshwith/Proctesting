/**
 * UPDATED admin.js — Multi-Tenant Version
 *
 * Key changes:
 *  - Role changed from "admin" → "tenantAdmin" (backward compat: accepts both)
 *  - ALL DB queries now scoped by req.user.tenantId
 *  - Student uploads inject tenantId
 *  - Faculty creation scoped to tenant
 *  - Audit logging on mutations
 */
import express from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Student from "../models/Student.js";
import auth from "../middleware/authMiddleware.js";
import multer from "multer";
import XLSX from "xlsx";
import { logAction } from "../utils/auditLogger.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Guard: tenantAdmin or legacy admin, tenant must be active
const TA = [auth, auth.requireActiveTenant, auth.requireRole("tenantAdmin", "admin")];

// ─── Create Faculty ───────────────────────────────────────────────────────────
router.post("/faculty", ...TA, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email and password are required" });
    }

    const tenantId = req.user.tenantId;

    // Email unique within tenant
    const existing = await User.findOne({ email, tenantId });
    if (existing) return res.status(400).json({ message: "Faculty with this email already exists in your organization" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await User.create({
      name, email, password: hashedPassword,
      role: "faculty", tenantId,
    });

    await logAction(req, { action: "CREATE_FACULTY", resource: "User", resourceId: user._id, meta: { email } });

    return res.status(201).json({
      id: user._id, name: user.name, email: user.email,
      role: user.role, tenantId: user.tenantId, createdAt: user.createdAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── List Faculty ─────────────────────────────────────────────────────────────
router.get("/faculty", ...TA, async (_req, res) => {
  try {
    const faculty = await User.find({ role: "faculty", tenantId: _req.user.tenantId })
      .select("name email role createdAt")
      .sort({ createdAt: -1 });
    return res.json(faculty);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── List Users (with filters) ────────────────────────────────────────────────
router.get("/users", ...TA, async (req, res) => {
  try {
    const {
      role, search, department, college,
      section, year, semester,
      limit = 200, page = 1,
    } = req.query;

    const tenantId = req.user.tenantId;
    const q = { tenantId };

    if (role && ["student", "faculty", "tenantAdmin"].includes(role)) q.role = role;
    if (department) q.department = department;
    if (college) q.college = college;
    if (section !== undefined) { const n = Number(section); if (!Number.isNaN(n)) q.section = n; }
    if (year !== undefined) { const n = Number(year); if (!Number.isNaN(n)) q.year = n; }
    if (semester !== undefined) { const n = Number(semester); if (!Number.isNaN(n)) q.semester = n; }
    if (search) {
      const s = String(search).trim();
      q.$or = [
        { name: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { rollno: { $regex: s, $options: "i" } },
      ];
    }

    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    const pg = Math.max(1, Number(page) || 1);

    const [items, total] = await Promise.all([
      User.find(q).select("-password").sort("-createdAt").skip((pg - 1) * lim).limit(lim),
      User.countDocuments(q),
    ]);

    return res.json({ items, total, page: pg, limit: lim });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Update User ──────────────────────────────────────────────────────────────
router.put("/users/:id", ...TA, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;

    // Ensure target user belongs to same tenant
    const target = await User.findOne({ _id: id, tenantId });
    if (!target) return res.status(404).json({ message: "User not found in your organization" });

    const allowed = ["name", "email", "rollno", "college", "year", "department", "section", "semester"];
    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }
    if (update.year !== undefined) update.year = Number(update.year);
    if (update.section !== undefined) update.section = Number(update.section);
    if (update.semester !== undefined) update.semester = Number(update.semester);

    const user = await User.findByIdAndUpdate(id, update, { new: true, runValidators: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    await logAction(req, { action: "UPDATE_USER", resource: "User", resourceId: id, meta: update });

    return res.json(user);
  } catch (err) {
    console.error(err);
    if (err?.code === 11000) return res.status(400).json({ message: "Duplicate key", keyValue: err.keyValue });
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete User ──────────────────────────────────────────────────────────────
router.delete("/users/:id", ...TA, async (req, res) => {
  try {
    const { id } = req.params;
    const tenantId = req.user.tenantId;

    const user = await User.findOneAndDelete({ _id: id, tenantId });
    if (!user) return res.status(404).json({ message: "User not found in your organization" });

    await logAction(req, { action: "DELETE_USER", resource: "User", resourceId: id, meta: { email: user.email, role: user.role } });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Reset User Password ──────────────────────────────────────────────────────
router.post("/users/:id/reset-password", ...TA, async (req, res) => {
  try {
    const { id } = req.params;
    const { toRollno = true } = req.body || {};
    const tenantId = req.user.tenantId;

    const user = await User.findOne({ _id: id, tenantId });
    if (!user) return res.status(404).json({ message: "User not found in your organization" });

    let newPassword = "changeme123";
    if (toRollno && user.rollno) newPassword = String(user.rollno);

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.mustChangePassword = true;
    await user.save();

    await logAction(req, { action: "RESET_PASSWORD", resource: "User", resourceId: id });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── List Students (roster) ───────────────────────────────────────────────────
router.get("/students", ...TA, async (req, res) => {
  try {
    const {
      search, department, college,
      section, year, semester,
      limit = 200, page = 1, sort = "-createdAt",
    } = req.query;

    const tenantId = req.user.tenantId;
    const q = { tenantId };

    if (department) q.department = department;
    if (college) q.college = college;
    if (section !== undefined) { const n = Number(section); if (!Number.isNaN(n)) q.section = n; }
    if (year !== undefined) { const n = Number(year); if (!Number.isNaN(n)) q.year = n; }
    if (semester !== undefined) { const n = Number(semester); if (!Number.isNaN(n)) q.semester = n; }
    if (search) {
      const s = String(search).trim();
      q.$or = [
        { name: { $regex: s, $options: "i" } },
        { email: { $regex: s, $options: "i" } },
        { rollno: { $regex: s, $options: "i" } },
      ];
    }

    const lim = Math.max(1, Math.min(500, Number(limit) || 200));
    const pg = Math.max(1, Number(page) || 1);

    const [items, total] = await Promise.all([
      Student.find(q).sort(sort).skip((pg - 1) * lim).limit(lim),
      Student.countDocuments(q),
    ]);

    return res.json({ items, total, page: pg, limit: lim });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Bulk Upload Students (CSV/XLSX) ─────────────────────────────────────────
router.post("/students/upload", ...TA, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const tenantId = req.user.tenantId;

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

    let created = 0, skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const map = {};
      Object.keys(r).forEach((k) => (map[norm(k)] = r[k]));

      const rollno = String(map["rollno"] || map["rollnumber"] || "").trim();
      const name = String(map["name"] || "").trim();
      const dept = String(map["dept"] || map["department"] || "").trim();
      const college = String(map["college"] || "").trim();
      const sectionRaw = String(map["section"] || "").trim();
      const semRaw = String(map["semester"] || map["sem"] || "").trim();

      if (!rollno || !name) {
        skipped++;
        errors.push({ row: i + 2, error: "Missing rollno or name" });
        continue;
      }

      const section = sectionRaw ? Number(sectionRaw) : undefined;
      const semester = semRaw ? Number(semRaw) : undefined;
      const year = semester ? Math.max(1, Math.min(4, Math.ceil(semester / 2))) : undefined;

      // Unique within tenant
      const existing = await Student.findOne({ rollno, tenantId });
      if (existing) { skipped++; continue; }

      try {
        await Student.create({
          rollno, name, tenantId,
          email: `${rollno}@students.local`,
          college: college || undefined,
          year,
          department: dept || undefined,
          section: typeof section === "number" && !Number.isNaN(section) ? section : undefined,
          semester: typeof semester === "number" && !Number.isNaN(semester) ? semester : undefined,
        });
        created++;
      } catch (e) {
        skipped++;
        errors.push({ row: i + 2, error: e.message });
      }
    }

    await logAction(req, {
      action: "BULK_UPLOAD_STUDENTS",
      resource: "Student",
      meta: { total: rows.length, created, skipped },
    });

    return res.json({ total: rows.length, created, skipped, errors });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to process file" });
  }
});

// ─── Tenant-scoped Audit Logs ────────────────────────────────────────────────
router.get("/audit-logs", ...TA, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { action, from, to, limit = 50, page = 1 } = req.query;

    const filter = { tenantId };
    if (action) filter.action = { $regex: action, $options: "i" };
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const { default: AuditLog } = await import("../models/AuditLog.js");
    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    return res.json({ total, page: Number(page), logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Tenant Stats Dashboard ───────────────────────────────────────────────────
router.get("/stats", ...TA, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const Exam = (await import("../models/Exam.js")).default;
    const Attempt = (await import("../models/Attempt.js")).default;

    const [students, faculty, exams, attempts, submittedAttempts] = await Promise.all([
      Student.countDocuments({ tenantId }),
      User.countDocuments({ tenantId, role: "faculty" }),
      Exam.countDocuments({ tenantId }),
      Attempt.countDocuments({ tenantId }),
      Attempt.countDocuments({ tenantId, status: "submitted" }),
    ]);

    return res.json({
      students, faculty, exams,
      attempts: { total: attempts, submitted: submittedAttempts },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;