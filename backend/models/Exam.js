/**
 * UPDATED Exam.js — Multi-Tenant Version
 *
 * Changes from original:
 *  - Added tenantId (required)
 *  - Compound index on (tenantId + createdBy)
 */
import mongoose from "mongoose";

const QuestionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["single", "mcq", "text"], required: true },
    text: { type: String, required: true },
    additionalInfo: { type: String, default: "" },
    options: [{ type: String }],
    correctAnswers: [{ type: Number }],
    points: { type: Number, default: 1, min: 0 },
  },
  { _id: false }
);

const ExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String },
    durationMins: { type: Number, required: true, min: 1 },
    window: {
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    questions: { type: [QuestionSchema], default: [] },

    // MULTI-TENANT KEY
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    assignmentCriteria: {
      college: { type: String },
      year: [{ type: Number, min: 1, max: 4 }],
      department: [{ type: String }],
      section: [{ type: Number, min: 1, max: 5 }],
      semester: [{ type: Number, min: 1, max: 8 }],
    },
    retakeGrants: {
      type: [
        new mongoose.Schema(
          {
            studentId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: true,
              index: true,
            },
            remaining: { type: Number, default: 1, min: 0 },
            grantedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    proctoringTier: {
      type: String,
      enum: ["full", "snapshot", "event-only"],
      default: "full",
    },
  },
  { timestamps: true }
);

ExamSchema.pre("validate", function (next) {
  const w = this.window || {};
  if (!w.start || !w.end) {
    this.invalidate("window", "Exam window requires start and end");
  } else if (new Date(w.end).getTime() <= new Date(w.start).getTime()) {
    this.invalidate("window.end", "Exam window end must be after start");
  }
  next();
});

// Compound index for fast tenant-scoped queries
ExamSchema.index({ tenantId: 1, createdBy: 1 });
ExamSchema.index({ tenantId: 1, "window.start": 1, "window.end": 1 });

export default mongoose.model("Exam", ExamSchema);