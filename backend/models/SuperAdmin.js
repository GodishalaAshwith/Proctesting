import mongoose from "mongoose";

const SuperAdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true },
    role: { type: String, default: "superadmin", immutable: true },
    isSuperAdmin: { type: Boolean, default: true, immutable: true },
  },
  { timestamps: true }
);

export default mongoose.model("SuperAdmin", SuperAdminSchema, "superadmins");