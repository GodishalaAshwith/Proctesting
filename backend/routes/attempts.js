/**
 * UPDATED attempts.js — Multi-Tenant Version
 *
 * Key changes:
 *  - All Attempt.create() calls inject tenantId
 *  - All Attempt.find() and Exam.find() queries include tenantId filter
 *  - ProctoringEvent.create() injects tenantId
 *  - Faculty cross-tenant access blocked via tenantId on Exam lookup
 *  - requireActiveTenant guard on all routes
 */
import express from "express";
import auth from "../middleware/authMiddleware.js";
import Exam from "../models/Exam.js";
import Attempt from "../models/Attempt.js";
import ProctoringEvent from "../models/ProctoringEvent.js";
import User from "../models/User.js";
import Student from "../models/Student.js";
import crypto from "crypto";
import { logAction } from "../utils/auditLogger.js";

const router = express.Router();

// ─── Helpers (unchanged from original) ───────────────────────────────────────
const matchesCriteria = (exam, student) => {
  const c = exam.assignmentCriteria || {};
  const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : v);
  if (c.college && student.college) { if (norm(c.college) !== norm(student.college)) return false; }
  if (Array.isArray(c.year) && c.year.length > 0) { if (student.year == null || !c.year.includes(student.year)) return false; }
  if (Array.isArray(c.department) && c.department.length > 0) {
    if (!student.department) return false;
    const set = new Set(c.department.map(norm));
    if (!set.has(norm(student.department))) return false;
  }
  if (Array.isArray(c.section) && c.section.length > 0) { if (student.section == null || !c.section.includes(student.section)) return false; }
  return true;
};

const sanitizeExamForStudent = (exam) => ({
  _id: exam._id, title: exam.title, description: exam.description,
  durationMins: exam.durationMins, proctoringTier: exam.proctoringTier, window: exam.window,
  questions: exam.questions.map((q) => ({
    type: q.type, text: q.text,
    options: q.type === "text" ? [] : q.options,
    points: q.points,
  })),
});

const marksheetColumnHeader = (idx, q) => {
  const info = String(q?.additionalInfo || "").trim();
  return info ? `Q${idx + 1} (${info})` : `Q${idx + 1}`;
};

const scoreQuestion = (q, given) => {
  if (!q) return 0;
  const pts = Number(q.points || 0) || 0;
  if (q.type === "text") return null;
  if (q.type === "single") {
    const correct = Array.isArray(q.correctAnswers) ? q.correctAnswers[0] : null;
    return typeof given === "number" && correct != null && given === correct ? pts : 0;
  }
  if (q.type === "mcq") {
    const correct = new Set(q.correctAnswers || []);
    const givenSet = new Set(Array.isArray(given) ? given : []);
    if (correct.size !== givenSet.size) return 0;
    for (const i of correct) { if (!givenSet.has(i)) return 0; }
    return pts;
  }
  return 0;
};

const scoreAttempt = (attempt, exam) => {
  let total = 0, manualNeeded = false;
  const ansMap = new Map((attempt.answers || []).map((a) => [a.questionIndex, a.value]));
  exam.questions.forEach((q, idx) => {
    if (q.type === "text") { manualNeeded = true; return; }
    const given = ansMap.get(idx);
    if (q.type === "single") {
      if (typeof given === "number" && Array.isArray(q.correctAnswers) && q.correctAnswers.length === 1) {
        if (given === q.correctAnswers[0]) total += q.points || 0;
      }
    } else if (q.type === "mcq") {
      const correct = new Set(q.correctAnswers || []);
      const givenSet = new Set(Array.isArray(given) ? given : []);
      if (correct.size === givenSet.size) {
        let allMatch = true;
        for (const i of correct) { if (!givenSet.has(i)) { allMatch = false; break; } }
        if (allMatch) total += q.points || 0;
      }
    }
  });
  return { total, manualNeeded };
};

// ─── Start Attempt ────────────────────────────────────────────────────────────
router.post("/start", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const { examId, deviceInfo, proctoringTier } = req.body || {};
    if (!examId) return res.status(400).json({ message: "examId is required" });

    const tenantId = req.user.tenantId;

    let student = null;
    if (req.user.model === "Student") {
      student = await Student.findOne({ _id: req.user.id, tenantId }).select("college year department section rollno email");
      if (!student && (req.user.rollno || req.user.email)) {
        student = await Student.findOne({
          tenantId,
          $or: [
            req.user.rollno ? { rollno: req.user.rollno } : null,
            req.user.email ? { email: req.user.email } : null,
          ].filter(Boolean),
        }).select("college year department section rollno email");
      }
    } else {
      const authUser = await User.findOne({ _id: req.user.id, tenantId }).select("rollno email");
      student = await Student.findOne(
        authUser?.rollno ? { rollno: authUser.rollno, tenantId } : { email: authUser?.email, tenantId }
      ).select("college year department section");
    }

    // TENANT SCOPED exam lookup
    const exam = await Exam.findOne({ _id: examId, tenantId });
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const now = new Date();
    if (!(exam.window?.start <= now && now <= exam.window?.end)) {
      return res.status(400).json({ message: "Exam is not active right now" });
    }
    if (!matchesCriteria(exam, student)) {
      return res.status(403).json({ message: "You are not assigned to this exam" });
    }

    let attempt = await Attempt.findOne({
      examId, tenantId,
      studentId: req.user.id,
      studentRef: req.user.model || "User",
    }).sort({ createdAt: -1 });

    // Legacy fallback
    if (!attempt && (req.user.model || "User") === "Student") {
      const s = await Student.findById(req.user.id).select("rollno email");
      if (s) {
        const maybeUser = await User.findOne({
          tenantId,
          $or: [
            s.rollno ? { rollno: s.rollno } : null,
            s.email ? { email: s.email } : null,
          ].filter(Boolean),
        }).select("_id");
        if (maybeUser) {
          attempt = await Attempt.findOne({
            examId, tenantId, studentId: maybeUser._id,
            $or: [{ studentRef: "User" }, { studentRef: { $exists: false } }],
          }).sort({ createdAt: -1 });
        }
      }
    }

    if (attempt && attempt.status === "in-progress") {
      const elapsedEnd = new Date(attempt.startedAt.getTime() + exam.durationMins * 60000);
      if (now > elapsedEnd) {
        attempt.status = "invalid";
        attempt.submittedAt = now;
        await attempt.save();
        const grantIdx = (exam.retakeGrants || []).findIndex(
          (g) => String(g.studentId) === String(req.user.id) && (g.remaining || 0) > 0
        );
        if (grantIdx === -1) {
          return res.status(400).json({ message: "Your previous attempt has already ended. Please contact faculty." });
        }
      }
    }

    if (!attempt) {
      attempt = await Attempt.create({
        examId, tenantId,
        studentId: req.user.id,
        studentRef: req.user.model || "User",
        startedAt: now, status: "in-progress",
        deviceInfo: deviceInfo || {},
        proctoringTier: proctoringTier || "full",
      });
    } else if (attempt.status !== "in-progress") {
      const grants = exam.retakeGrants || [];
      const idx = grants.findIndex(
        (g) => String(g.studentId) === String(req.user.id) && (g.remaining || 0) > 0
      );
      if (idx === -1) return res.status(400).json({ message: "You have already submitted this exam." });

      grants[idx].remaining = Math.max(0, (grants[idx].remaining || 0) - 1);
      exam.retakeGrants = grants;
      await exam.save();

      attempt = await Attempt.create({
        examId, tenantId,
        studentId: req.user.id,
        studentRef: req.user.model || "User",
        startedAt: now, status: "in-progress",
        deviceInfo: deviceInfo || {},
        proctoringTier: proctoringTier || "full",
      });
    }

    const endAt = new Date(attempt.startedAt.getTime() + exam.durationMins * 60000);

    return res.json({
      attemptId: attempt._id,
      serverStartTime: attempt.startedAt,
      serverEndTime: endAt,
      durationMins: exam.durationMins,
      exam: sanitizeExamForStudent(exam),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Save Answers ─────────────────────────────────────────────────────────────
router.post("/save", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const { attemptId, answers } = req.body || {};
    if (!attemptId || !Array.isArray(answers)) {
      return res.status(400).json({ message: "attemptId and answers are required" });
    }

    const attempt = await Attempt.findOne({
      _id: attemptId, tenantId: req.user.tenantId,
      studentId: req.user.id, studentRef: req.user.model || "User",
    });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    if (attempt.status !== "in-progress") return res.status(400).json({ message: "Attempt is not in progress" });

    const exam = await Exam.findById(attempt.examId);
    const endAt = new Date(attempt.startedAt.getTime() + exam.durationMins * 60000);
    if (new Date() > endAt) return res.status(400).json({ message: "Exam time is over" });

    const map = new Map((attempt.answers || []).map((a) => [a.questionIndex, a]));
    for (const a of answers) {
      if (typeof a.questionIndex !== "number") continue;
      map.set(a.questionIndex, { questionIndex: a.questionIndex, value: a.value });
    }
    attempt.answers = Array.from(map.values());
    await attempt.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Submit Attempt ───────────────────────────────────────────────────────────
router.post("/submit", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const { attemptId, answers } = req.body || {};
    if (!attemptId) return res.status(400).json({ message: "attemptId is required" });

    const attempt = await Attempt.findOne({
      _id: attemptId, tenantId: req.user.tenantId,
      studentId: req.user.id, studentRef: req.user.model || "User",
    });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    if (attempt.status !== "in-progress") return res.status(400).json({ message: "Attempt is not in progress" });

    const exam = await Exam.findById(attempt.examId);

    if (Array.isArray(answers)) {
      const map = new Map((attempt.answers || []).map((a) => [a.questionIndex, a]));
      for (const a of answers) {
        if (typeof a?.questionIndex !== "number") continue;
        map.set(a.questionIndex, { questionIndex: a.questionIndex, value: a.value });
      }
      attempt.answers = Array.from(map.values());
    }

    const { total, manualNeeded } = scoreAttempt(attempt, exam);
    attempt.status = "submitted";
    attempt.submittedAt = new Date();
    attempt.score = total;
    attempt.manualNeeded = manualNeeded;

    const penMap = {
      "face-absent": 15, "face-mismatch": 30, "face-multiple": 30,
      "gaze-away": 5, "gaze-no-face": 10, "tab-blur": 5,
      "visibility-hidden": 10, "fullscreen-exit": 10, "window-resize": 10,
    };
    let penalty = 0;
    for (const v of attempt.violations || []) { penalty += penMap[v.type] || 2; }
    attempt.integrityScore = Math.max(0, 100 - penalty);

    const hashPayload = JSON.stringify({
      attemptId: attempt._id.toString(), studentId: attempt.studentId.toString(),
      examId: attempt.examId.toString(), score: attempt.score,
      integrityScore: attempt.integrityScore,
      violationsCount: (attempt.violations || []).length,
      answers: attempt.answers || [],
    });
    attempt.blockchainHash = crypto.createHash("sha256").update(hashPayload).digest("hex");

    await attempt.save();

    return res.json({ score: total, manualNeeded, submittedAt: attempt.submittedAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Verify Hash (faculty) ────────────────────────────────────────────────────
router.post("/:id/verify-hash", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const attempt = await Attempt.findOne({ _id: req.params.id, tenantId: req.user.tenantId });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });

    const hashPayload = JSON.stringify({
      attemptId: attempt._id.toString(), studentId: attempt.studentId.toString(),
      examId: attempt.examId.toString(), score: attempt.score,
      integrityScore: attempt.integrityScore,
      violationsCount: (attempt.violations || []).length,
      answers: attempt.answers || [],
    });
    const calculatedHash = crypto.createHash("sha256").update(hashPayload).digest("hex");
    const verified = attempt.blockchainHash && attempt.blockchainHash === calculatedHash;

    return res.json({ verified, storedHash: attempt.blockchainHash, calculatedHash });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get Attempt (student owner) ─────────────────────────────────────────────
router.get("/:id", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const attempt = await Attempt.findOne({
      _id: req.params.id, tenantId: req.user.tenantId,
      studentId: req.user.id, studentRef: req.user.model || "User",
    });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });
    return res.json(attempt);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Log Proctoring Event (student) ──────────────────────────────────────────
router.post("/:id/proctor", auth, auth.requireActiveTenant, auth.requireRole("student"), async (req, res) => {
  try {
    const attempt = await Attempt.findOne({
      _id: req.params.id, tenantId: req.user.tenantId,
      studentId: req.user.id, studentRef: req.user.model || "User",
    });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });

    const { type, meta } = req.body || {};
    if (!type) return res.status(400).json({ message: "type is required" });

    attempt.violations.push({ type, at: new Date(), meta });
    await attempt.save();

    await ProctoringEvent.create({
      attemptId: attempt._id,
      tenantId: req.user.tenantId,  // TENANT SCOPED
      type, meta,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Faculty: List Attempts for Exam ─────────────────────────────────────────
router.get("/exam/:examId/attempts", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.examId,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,
    });
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const attempts = await Attempt.find({ examId: exam._id, tenantId: req.user.tenantId })
      .select("studentId studentRef status score integrityScore blockchainHash submittedAt violations createdAt startedAt")
      .populate({ path: "studentId", select: "name email rollno", strictPopulate: false })
      .sort({ createdAt: -1 })
      .lean();

    const mapped = attempts.map((a) => ({
      _id: a._id,
      studentId: a.studentId?._id || a.studentId,
      student: a.studentId && typeof a.studentId === "object"
        ? { _id: a.studentId._id, name: a.studentId.name, email: a.studentId.email, rollNo: a.studentId.rollno }
        : null,
      status: a.status, score: a.score, integrityScore: a.integrityScore,
      blockchainHash: a.blockchainHash, submittedAt: a.submittedAt, startedAt: a.startedAt,
      violationsCount: (a.violations || []).length,
    }));

    return res.json(mapped);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Faculty: Marksheet Export ────────────────────────────────────────────────
router.get("/exam/:examId/marksheet", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const exam = await Exam.findOne({
      _id: req.params.examId,
      createdBy: req.user.id,
      tenantId: req.user.tenantId,
    }).select("title questions").lean();
    if (!exam) return res.status(404).json({ message: "Exam not found" });

    const questions = Array.isArray(exam.questions) ? exam.questions : [];
    const headers = questions.map((q, idx) => marksheetColumnHeader(idx, q));

    const attempts = await Attempt.find({
      examId: exam._id, tenantId: req.user.tenantId, status: "submitted",
    })
      .select("studentId studentRef answers submittedAt createdAt")
      .populate({ path: "studentId", select: "name email rollno", strictPopulate: false })
      .sort({ submittedAt: -1, createdAt: -1 })
      .lean();

    const studentKey = (a) => {
      const s = a.studentId;
      if (s && typeof s === "object") {
        return String(s.rollno || "").trim() || String(s.email || "").trim() || String(s._id || "").trim();
      }
      return String(s || "").trim();
    };

    const latestByStudent = new Map();
    for (const a of attempts) {
      const key = studentKey(a);
      if (!key) continue;
      if (!latestByStudent.has(key)) latestByStudent.set(key, a);
    }

    const rows = Array.from(latestByStudent.values())
      .map((a) => {
        const s = a.studentId && typeof a.studentId === "object" ? a.studentId : null;
        const rollNo = String(s?.rollno || "").trim() || String(s?.email || "").trim() || String(a.studentId || "").trim();
        const ansMap = new Map((a.answers || []).filter((x) => typeof x?.questionIndex === "number").map((x) => [x.questionIndex, x.value]));
        const row = { RollNo: rollNo };
        let total = 0;
        for (let i = 0; i < questions.length; i++) {
          const header = headers[i];
          const mark = scoreQuestion(questions[i], ansMap.get(i));
          row[header] = mark == null ? "" : mark;
          if (typeof mark === "number" && Number.isFinite(mark)) total += mark;
        }
        row.Total = total;
        return row;
      })
      .sort((a, b) => String(a.RollNo).localeCompare(String(b.RollNo)));

    return res.json({ examTitle: exam.title || "exam", rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Faculty: Grant Retake ────────────────────────────────────────────────────
router.post("/exam/:examId/grant-retake", auth, auth.requireActiveTenant, auth.requireRole("faculty"), async (req, res) => {
  try {
    const { examId } = req.params;
    const { studentId, count } = req.body || {};
    const inc = Math.max(1, Number(count) || 1);

    const exam = await Exam.findOne({ _id: examId, createdBy: req.user.id, tenantId: req.user.tenantId });
    if (!exam) return res.status(404).json({ message: "Exam not found" });
    if (!studentId) return res.status(400).json({ message: "studentId is required" });

    const grants = exam.retakeGrants || [];
    const idx = grants.findIndex((g) => String(g.studentId) === String(studentId));
    if (idx === -1) {
      grants.push({ studentId, remaining: inc, grantedAt: new Date() });
    } else {
      grants[idx].remaining = Math.max(0, (grants[idx].remaining || 0) + inc);
      grants[idx].grantedAt = new Date();
    }
    exam.retakeGrants = grants;
    await exam.save();

    const entry = exam.retakeGrants.find((g) => String(g.studentId) === String(studentId));
    return res.json({ examId: exam._id, studentId, remaining: entry?.remaining || 0 });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Get Proctoring Events ────────────────────────────────────────────────────
router.get("/:id/events", auth, auth.requireActiveTenant, async (req, res) => {
  try {
    const attempt = await Attempt.findOne({ _id: req.params.id, tenantId: req.user.tenantId });
    if (!attempt) return res.status(404).json({ message: "Attempt not found" });

    const isOwner = String(attempt.studentId) === String(req.user.id) && req.user.role === "student";
    let isFacultyOwner = false;
    if (req.user.role === "faculty") {
      const exam = await Exam.findOne({ _id: attempt.examId, tenantId: req.user.tenantId });
      if (exam && String(exam.createdBy) === String(req.user.id)) isFacultyOwner = true;
    }
    if (!isOwner && !isFacultyOwner) return res.status(403).json({ message: "Forbidden" });

    const events = await ProctoringEvent.find({ attemptId: attempt._id, tenantId: req.user.tenantId }).sort({ createdAt: 1 });
    return res.json(events);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;