import mongoose from "mongoose";

const TenantSchema = new mongoose.Schema(
  {
    // System-generated unique tenant ID (e.g., "TEN-CBIT-4F2A")
    tenantCode: { type: String, required: true, unique: true, index: true },

    // Organization display name
    name: { type: String, required: true },

    // Subdomain slug: "cbit" → cbit.yourplatform.com
    subdomain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      match: [/^[a-z0-9-]+$/, "Subdomain must be lowercase alphanumeric with hyphens only"],
    },

    // Tenant status
    status: {
      type: String,
      enum: ["active", "disabled", "trial"],
      default: "active",
      index: true,
    },

    // White-label branding
    branding: {
      logoUrl: { type: String, default: "" },
      primaryColor: { type: String, default: "#4f46e5" },
      secondaryColor: { type: String, default: "#7c3aed" },
      organizationTagline: { type: String, default: "" },
    },

    // Contact info
    contactEmail: { type: String },
    contactPhone: { type: String },
    address: { type: String },

    // Billing & plan (optional SaaS model)
    plan: {
      type: String,
      enum: ["free", "starter", "pro", "enterprise"],
      default: "free",
    },
    maxStudents: { type: Number, default: 500 },
    maxExams: { type: Number, default: 50 },
    maxFaculty: { type: Number, default: 20 },

    // Audit metadata
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SuperAdmin",
    },
    disabledAt: { type: Date, default: null },
    disabledReason: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("Tenant", TenantSchema);