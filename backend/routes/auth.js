/**
 * UPDATED auth.js — Multi-Tenant Version
 *
 * Key changes:
 *  - JWT now includes tenantId for all non-superadmin users
 *  - login-user and login-student both inject tenantId into token
 *  - All DB lookups for students are scoped to tenantId
 *  - TenantAdmin login is handled via login-user (role: tenantAdmin)
 *  - mustChangePassword flag surfaced in response
 */
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import authMiddleware from "../middleware/authMiddleware.js";
import Student from "../models/Student.js";

const router = express.Router();

// ─── Helper: sign JWT with tenantId ─────────────────────────────────────────
const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });

// ─── Register (Student via self-registration — only if open registration enabled) ──
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, college, year, department, section, tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({ message: "tenantId is required for registration" });
    }

    // Check email uniqueness WITHIN tenant
    const userExists = await User.findOne({ email, tenantId });
    if (userExists) return res.status(400).json({ message: "User already exists in this organization" });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = new User({
      name, email, password: hashedPassword,
      role: "student", tenantId,
      college, year, department, section,
    });
    await user.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Login: Faculty / TenantAdmin / Admin (Users collection) ─────────────────
router.post("/login-user", async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    const identifier = (email || "").trim();

    // Build query — scope to tenant if provided (tenantId is optional for backward compat)
    const baseQuery = identifier.includes("@")
      ? { email: identifier }
      : { rollno: identifier };

    // If tenantId supplied, enforce scoping; otherwise find first match (legacy)
    const query = tenantId
      ? { ...baseQuery, tenantId }
      : baseQuery;

    const user = await User.findOne(query);
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // Check tenant is active (skip for legacy admin without tenantId)
    if (user.tenantId) {
      const { default: Tenant } = await import("../models/Tenant.js");
      const tenant = await Tenant.findById(user.tenantId).select("status name").lean();
      if (!tenant || tenant.status !== "active") {
        return res.status(403).json({
          message: `Your organization has been ${tenant?.status || "deactivated"}. Contact platform support.`,
        });
      }
    }

    // For student role: verify they exist in roster
    if (user.role === "student") {
      const rosterOk = await Student.exists({
        tenantId: user.tenantId,
        $or: [
          user.rollno ? { rollno: user.rollno } : null,
          user.email ? { email: user.email } : null,
        ].filter(Boolean),
      });
      if (!rosterOk) {
        return res.status(403).json({ message: "Student not found in roster. Contact admin." });
      }
    }

    const token = signToken({
      id: user._id,
      role: user.role,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      model: "User",
    });

    let enriched = {
      id: user._id,
      name: user.name,
      email: user.email,
      rollno: user.rollno,
      role: user.role,
      tenantId: user.tenantId,
      mustChangePassword: user.mustChangePassword || false,
    };

    // Enrich students with roster data
    if (user.role === "student") {
      const roster = await Student.findOne(
        user.rollno ? { rollno: user.rollno, tenantId: user.tenantId } : { email: user.email, tenantId: user.tenantId }
      ).select("college year department section semester");
      if (roster) {
        enriched = { ...enriched, college: roster.college, year: roster.year, department: roster.department, section: roster.section, semester: roster.semester };
      }
    }

    res.json({ token, user: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Login: Student via Students roster ───────────────────────────────────────
router.post("/login-student", async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    const identifier = (email || "").trim();

    const baseQuery = identifier.includes("@")
      ? { email: identifier }
      : { rollno: identifier };

    // Tenant-scoped lookup
    const query = tenantId ? { ...baseQuery, tenantId } : baseQuery;

    const student = await Student.findOne(query);
    if (!student) return res.status(400).json({ message: "Invalid credentials" });

    // Default password is roll number
    if (String(password) !== String(student.rollno)) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check tenant active
    if (student.tenantId) {
      const { default: Tenant } = await import("../models/Tenant.js");
      const tenant = await Tenant.findById(student.tenantId).select("status").lean();
      if (!tenant || tenant.status !== "active") {
        return res.status(403).json({ message: "Your organization is currently inactive." });
      }
    }

    const token = signToken({
      id: student._id,
      role: "student",
      tenantId: student.tenantId ? String(student.tenantId) : null,
      model: "Student",
      rollno: student.rollno,
      email: student.email || `${student.rollno}@students.local`,
    });

    return res.json({
      token,
      user: {
        id: student._id,
        role: "student",
        name: student.name,
        email: student.email || `${student.rollno}@students.local`,
        rollno: student.rollno,
        tenantId: student.tenantId,
        college: student.college,
        year: student.year,
        department: student.department,
        section: student.section,
        semester: student.semester,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Get Current User Info ────────────────────────────────────────────────────
router.get("/user", authMiddleware, async (req, res) => {
  try {
    if (req.user.model === "Student") {
      const s = await Student.findById(req.user.id);
      if (!s) return res.status(404).json({ message: "User not found" });
      return res.json({
        id: s._id, role: "student", name: s.name,
        email: s.email || `${s.rollno}@students.local`,
        rollno: s.rollno, tenantId: s.tenantId,
        college: s.college, year: s.year,
        department: s.department, section: s.section, semester: s.semester,
      });
    } else {
      const user = await User.findById(req.user.id).select("-password");
      if (!user) return res.status(404).json({ message: "User not found" });

      if (user.role === "student") {
        const roster = await Student.findOne(
          user.rollno
            ? { rollno: user.rollno, tenantId: user.tenantId }
            : { email: user.email, tenantId: user.tenantId }
        ).select("college year department section semester");
        return res.json({
          ...user.toObject(),
          college: roster?.college, year: roster?.year,
          department: roster?.department, section: roster?.section, semester: roster?.semester,
        });
      }
      return res.json(user);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Update Profile ───────────────────────────────────────────────────────────
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    if (req.user.model === "Student") {
      return res.status(403).json({ message: "Students cannot update roster profile here" });
    }
    const { name, college, year, department, section } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (typeof name === "string" && name.trim().length > 0) user.name = name.trim();
    if (typeof college === "string") user.college = college.trim();
    if (typeof department === "string") user.department = department.trim();
    if (year !== undefined) { const y = Number(year); if (!Number.isNaN(y)) user.year = y; }
    if (section !== undefined) { const s = Number(section); if (!Number.isNaN(s)) user.section = s; }

    if (user.year != null && (user.year < 1 || user.year > 4)) return res.status(400).json({ message: "Year must be between 1 and 4" });
    if (user.section != null && (user.section < 1 || user.section > 5)) return res.status(400).json({ message: "Section must be between 1 and 5" });

    await user.save();
    const { password, ...safe } = user.toObject();
    return res.json(safe);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Change Password ──────────────────────────────────────────────────────────
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    if (req.user.model === "Student") {
      return res.status(403).json({ message: "Password change for students is not supported here." });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ message: "Provide currentPassword and newPassword (min 8 chars)" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.mustChangePassword = false; // clear forced-change flag
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;