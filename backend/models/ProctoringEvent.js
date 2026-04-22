/**
 * UPDATED ProctoringEvent.js — Multi-Tenant Version
 */
import mongoose from "mongoose";

const ProctoringEventSchema = new mongoose.Schema(
  {
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attempt",
      required: true,
      index: true,
    },

    // MULTI-TENANT KEY
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: [
        "tab-blur", "visibility-hidden", "fullscreen-exit",
        "return-timeout", "window-resize", "face-absent",
        "face-mismatch", "face-multiple", "gaze-away", "gaze-no-face",
      ],
      required: true,
    },
    at: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

ProctoringEventSchema.index({ tenantId: 1, attemptId: 1 });

export default mongoose.model("ProctoringEvent", ProctoringEventSchema);