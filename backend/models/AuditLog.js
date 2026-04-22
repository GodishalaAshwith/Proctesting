import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    // Who performed the action
    actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
    actorRole: {
      type: String,
      enum: ["superadmin", "tenantAdmin", "faculty", "student"],
      required: true,
    },
    actorName: { type: String },

    // Which tenant this action belongs to (null for superadmin global actions)
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
      default: null,
    },

    // What happened
    action: { type: String, required: true }, // e.g. "CREATE_EXAM", "DISABLE_TENANT"
    resource: { type: String }, // e.g. "Exam", "User", "Tenant"
    resourceId: { type: mongoose.Schema.Types.ObjectId },

    // Extra context
    meta: { type: mongoose.Schema.Types.Mixed },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

AuditLogSchema.index({ tenantId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, tenantId: 1 });

export default mongoose.model("AuditLog", AuditLogSchema);