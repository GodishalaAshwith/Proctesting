/**
 * UPDATED User.js — Multi-Tenant Version
 *
 * Changes from original:
 *  - Added tenantId field (required for faculty/tenantAdmin, null for superadmin)
 *  - Added "tenantAdmin" to role enum
 *  - Added compound index on (tenantId + email) for isolation
 *  - email uniqueness is now PER TENANT (removed global unique, use compound index)
 */
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // Email is unique WITHIN a tenant (compound index below)
    email: { type: String, required: true, index: true },

    rollno: { type: String, sparse: true, index: true },
    password: { type: String, required: true },

    // Role hierarchy
    role: {
      type: String,
      enum: ["student", "faculty", "tenantAdmin", "admin"], // "admin" kept for backward compat
      default: "student",
      index: true,
    },

    // MULTI-TENANT KEY — every user belongs to exactly one tenant
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: function () {
        return this.role !== "admin"; // legacy admin accounts may not have tenantId
      },
      index: true,
    },

    // Student profile fields (optional for non-students)
    college: { type: String },
    year: { type: Number, min: 1, max: 4 },
    department: { type: String },
    section: { type: Number, min: 1, max: 5 },
    semester: { type: Number, min: 1, max: 8 },

    // Whether this account was system-generated (tenantAdmin auto-created)
    systemGenerated: { type: Boolean, default: false },

    // Force password change on first login for auto-generated accounts
    mustChangePassword: { type: Boolean, default: false },

    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// CRITICAL: Unique email per tenant (not globally unique)
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });

// Efficient lookups by tenant
UserSchema.index({ tenantId: 1, role: 1 });
UserSchema.index({ tenantId: 1, rollno: 1 }, { sparse: true });

export default mongoose.model("User", UserSchema, "teachers");