/**
 * UPDATED exams.js — Multi-Tenant Version
 *
 * Key changes:
 *  - Exam creation injects tenantId
 *  - All queries filter by tenantId
 *  - Faculty can only see/edit their OWN exams within their tenant
 *  - Students can only see exams from their tenant
 *  - requireActiveTenant guard on all routes
 */
import express from "express";
import Exam from "../models/Exam.js";
import Attempt from "../models/Attempt.js";
import User from "../models/User.js";
import Student from "../models/Student.js";
import auth from "../middleware/authMiddleware.js";
import { logAction } from "../utils/auditLogger.js";

const router = express.Router();

// ─── Create Exam (faculty only) ───────────────────────────────────────────────
router.post("/", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const payload = req.body || {};
    const doc = new Exam({
      ...payload,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,  // TENANT SCOPED
    });
    await doc.validate();
    await doc.save();

    await logAction(req, { action: "CREATE_EXAM", resource: "Exam", resourceId: doc._id, meta: { title: doc.title } });

    return res.status(201).json(doc);
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── List My Exams (faculty) ──────────────────────────────────────────────────
router.get("/", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const list = await Exam.find({
      createdBy: req.user.id,
      tenantId: req.user.tenantId,  // TENANT SCOPED
    }).sort({ createdAt: -1 });
    return res.json(list);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Student: Available Exams ──────────────────────────────────────────────────
router.get("/available", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const now = new Date();
    const principalModel = req.user.model || "User";
    let student = null;
    let maybeUserId = null;

    if (principalModel === "Student") {
      let roster = await Student.findById(req.user.id).select("college year department section semester rollno email tenantId");
      if (!roster && (req.user.rollno || req.user.email)) {
        roster = await Student.findOne({
          tenantId: req.user.tenantId,
          $or: [
            req.user.rollno ? { rollno: req.user.rollno } : null,
            req.user.email ? { email: req.user.email } : null,
          ].filter(Boolean),
        }).select("college year department section semester rollno email");
      }
      if (!roster) return res.status(404).json({ message: "Student profile not found in roster" });
      student = roster;

      const maybeUser = await User.findOne({
        tenantId: req.user.tenantId,
        $or: [
          roster.rollno ? { rollno: roster.rollno } : null,
          roster.email ? { email: roster.email } : null,
        ].filter(Boolean),
      }).select("_id");
      maybeUserId = maybeUser?._id || null;
    } else {
      const authUser = await User.findById(req.user.id).select("rollno email tenantId");
      if (!authUser) return res.status(404).json({ message: "User not found" });
      const roster = await Student.findOne(
        authUser.rollno
          ? { rollno: authUser.rollno, tenantId: req.user.tenantId }
          : { email: authUser.email, tenantId: req.user.tenantId }
      ).select("college year department section semester");
      if (!roster) return res.status(404).json({ message: "Student profile not found in roster" });
      student = roster;
    }

    // TENANT SCOPED exam query
    const exams = await Exam.find({
      tenantId: req.user.tenantId,
      "window.end": { $gte: now },
    })
      .select("title description durationMins window assignmentCriteria proctoringTier retakeGrants")
      .sort({ "window.start": 1 });

    const matches = (exam) => {
      const c = exam.assignmentCriteria || {};
      const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : v);
      if (c.college && student.college) { if (norm(c.college) !== norm(student.college)) return false; }
      if (Array.isArray(c.year) && c.year.length > 0) { if (student.year == null || !c.year.includes(student.year)) return false; }
      if (Array.isArray(c.department) && c.department.length > 0) {
        if (!student.department) return false;
        const deptSet = new Set(c.department.map(norm));
        if (!deptSet.has(norm(student.department))) return false;
      }
      if (Array.isArray(c.section) && c.section.length > 0) { if (student.section == null || !c.section.includes(student.section)) return false; }
      if (Array.isArray(c.semester) && c.semester.length > 0) { if (student.semester == null || !c.semester.includes(student.semester)) return false; }
      return true;
    };

    const filtered = exams.filter(matches);
    const examIds = filtered.map((e) => e._id);

    const ors = [{ studentId: req.user.id, studentRef: principalModel, examId: { $in: examIds }, tenantId: req.user.tenantId }];
    if (principalModel === "User") {
      ors.push({ studentId: req.user.id, examId: { $in: examIds }, studentRef: { $exists: false }, tenantId: req.user.tenantId });
    }
    if (principalModel === "Student" && maybeUserId) {
      ors.push({ studentId: maybeUserId, studentRef: "User", examId: { $in: examIds }, tenantId: req.user.tenantId });
      ors.push({ studentId: maybeUserId, examId: { $in: examIds }, studentRef: { $exists: false }, tenantId: req.user.tenantId });
    }

    const attempts = await Attempt.find({ $or: ors }).select("examId status submittedAt");
    const byExam = new Map();
    attempts.forEach((a) => byExam.set(String(a.examId), a));

    const result = filtered.map((e) => {
      const a = byExam.get(String(e._id));
      let status = "not-started";
      if (a) status = a.status;

      if ((status === "submitted" || status === "invalid") && Array.isArray(e.retakeGrants)) {
        const grant = e.retakeGrants.find((g) => {
          if (String(g.studentId) === String(req.user.id)) return (g.remaining || 0) > 0;
          if (principalModel === "Student" && maybeUserId) {
            return String(g.studentId) === String(maybeUserId) && (g.remaining || 0) > 0;
          }
          return false;
        });
        if (grant) status = "not-started";
      }

      return {
        _id: e._id, title: e.title, description: e.description,
        durationMins: e.durationMins, window: e.window, status,
      };
    });

    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get Exam by ID (faculty owner within tenant) ─────────────────────────────
router.get("/:id", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,  // TENANT SCOPED
    });
    if (!exam) return res.status(404).json({ message: "Exam not found" });
    return res.json(exam);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Update Exam ──────────────────────────────────────────────────────────────
router.put("/:id", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const update = req.body || {};
    // Prevent overwriting tenantId via update payload
    delete update.tenantId;
    delete update.createdBy;

    const exam = await Exam.findOne({
      _id: req.params.id,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,
    });
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    Object.assign(exam, update);
    await exam.validate();
    await exam.save();

    await logAction(req, { action: "UPDATE_EXAM", resource: "Exam", resourceId: exam._id, meta: { title: exam.title } });

    return res.json(exam);
  } catch (err) {
    if (err.name === "ValidationError") return res.status(400).json({ message: err.message });
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Delete Exam ──────────────────────────────────────────────────────────────
router.delete("/:id", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const exam = await Exam.findOneAndDelete({
      _id: req.params.id,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,
    });
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    await logAction(req, { action: "DELETE_EXAM", resource: "Exam", resourceId: req.params.id });

    return res.json({ message: "Exam deleted" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;