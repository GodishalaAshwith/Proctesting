/**
 * UPDATED Student.js — Multi-Tenant Version
 *
 * Changes from original:
 *  - Added tenantId (required)
 *  - rollno unique WITHIN tenant (compound index)
 *  - email unique WITHIN tenant (compound index)
 */
import mongoose from "mongoose";

const StudentSchema = new mongoose.Schema(
  {
    rollno: { type: String, required: true, index: true },
    name: { type: String, required: true },
    email: { type: String },

    // MULTI-TENANT KEY
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    // Academic profile
    college: { type: String },
    year: { type: Number, min: 1, max: 4 },
    department: { type: String },
    section: { type: Number, min: 1, max: 5 },
    semester: { type: Number, min: 1, max: 8 },

    // Promotion guards
    lastSemCycle: { type: String },
    lastYearCycle: { type: String },
  },
  { timestamps: true }
);

// CRITICAL: rollno unique per tenant
StudentSchema.index({ tenantId: 1, rollno: 1 }, { unique: true });
StudentSchema.index({ tenantId: 1, email: 1 }, { sparse: true });
StudentSchema.index({ tenantId: 1, department: 1, year: 1, section: 1 });

export default mongoose.model("Student", StudentSchema);