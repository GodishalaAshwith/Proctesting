import mongoose from "mongoose";

const ProctoringEventSchema = new mongoose.Schema(
  {
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attempt",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "tab-blur",
        "visibility-hidden",
        "fullscreen-exit",
        "return-timeout",
      ],
      required: true,
    },
    at: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.model("ProctoringEvent", ProctoringEventSchema);
