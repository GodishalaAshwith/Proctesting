/**
 * migrate_add_tenantid.js
 * ONE-TIME migration: Creates a default tenant for existing data
 * and stamps all existing Users, Students, Exams, Attempts, ProctoringEvents
 * with that tenantId.
 *
 * Run BEFORE going multi-tenant on a live database.
 *
 * Usage:
 *   DEFAULT_TENANT_NAME="My College" DEFAULT_TENANT_SUBDOMAIN="mycollege" node migrate_add_tenantid.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const conn = await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log("✅ Connected to MongoDB");

// ─── Inline schemas (avoid circular model issues in migration) ────────────────
const Tenant = mongoose.model("Tenant", new mongoose.Schema({
  tenantCode: String, name: String, subdomain: String,
  status: { type: String, default: "active" },
  plan: { type: String, default: "free" },
}, { timestamps: true }));

const db = mongoose.connection.db;

const tenantName = process.env.DEFAULT_TENANT_NAME || "Default Organization";
const tenantSubdomain = process.env.DEFAULT_TENANT_SUBDOMAIN || "default";

// Step 1: Create default tenant
let tenant = await Tenant.findOne({ subdomain: tenantSubdomain });
if (!tenant) {
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  tenant = await Tenant.create({
    tenantCode: `TEN-${tenantSubdomain.toUpperCase().slice(0, 6)}-${suffix}`,
    name: tenantName,
    subdomain: tenantSubdomain,
  });
  console.log(`✅ Created default tenant: ${tenant.name} (${tenant._id})`);
} else {
  console.log(`ℹ️  Using existing tenant: ${tenant.name} (${tenant._id})`);
}

const tenantId = tenant._id;

// Step 2: Stamp all collections
const collections = [
  { name: "teachers", label: "Users/Faculty" },       // User model uses "teachers" collection
  { name: "students", label: "Students" },
  { name: "exams", label: "Exams" },
  { name: "attempts", label: "Attempts" },
  { name: "proctoringevents", label: "ProctoringEvents" },
];

for (const col of collections) {
  const collection = db.collection(col.name);
  const result = await collection.updateMany(
    { tenantId: { $exists: false } },
    { $set: { tenantId } }
  );
  console.log(`✅ ${col.label}: stamped ${result.modifiedCount} documents`);
}

// Step 3: Create default TenantAdmin from existing admin user
const adminUser = await db.collection("teachers").findOne({ role: "admin" });
if (adminUser && !adminUser.tenantId) {
  await db.collection("teachers").updateOne(
    { _id: adminUser._id },
    { $set: { tenantId, role: "tenantAdmin" } }
  );
  console.log(`✅ Promoted admin user to tenantAdmin: ${adminUser.email}`);
}

// Step 4: Drop old global unique index on email in teachers (now compound per-tenant)
try {
  await db.collection("teachers").dropIndex("email_1");
  console.log("✅ Dropped old global email unique index from teachers");
} catch (e) {
  console.log("ℹ️  Global email index not found or already dropped:", e.message);
}

try {
  await db.collection("students").dropIndex("rollno_1");
  console.log("✅ Dropped old global rollno unique index from students");
} catch (e) {
  console.log("ℹ️  Global rollno index not found or already dropped:", e.message);
}

console.log("\n🎉 Migration complete. Restart your server to apply new compound indexes.");
process.exit(0);