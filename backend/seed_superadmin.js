/**
 * seed_superadmin.js
 * Run ONCE to create the platform SuperAdmin account.
 *
 * Usage:
 *   SUPERADMIN_EMAIL=platform@yourdomain.com SUPERADMIN_PASSWORD=StrongPass123! node seed_superadmin.js
 */
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const SuperAdminSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: "superadmin" },
    isSuperAdmin: { type: Boolean, default: true },
  },
  { timestamps: true }
);
const SuperAdmin = mongoose.model("SuperAdmin", SuperAdminSchema, "superadmins");

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in .env");
    process.exit(1);
  }

  const existing = await SuperAdmin.findOne({ email });
  if (existing) {
    console.log(`⚠️  SuperAdmin already exists: ${email}`);
    process.exit(0);
  }

  const hash = await bcrypt.hash(password, 12);
  await SuperAdmin.create({
    name: "Platform Owner",
    email,
    password: hash,
  });

  console.log(`✅ SuperAdmin created: ${email}`);
  console.log("   Login at: POST /api/superadmin/login");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});