/**
 * tenantUtils.js
 * Utilities for tenant creation: generating unique codes and credentials.
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * Generates a human-readable tenant code.
 * e.g., "TEN-CBIT-4F2A"
 */
export const generateTenantCode = (orgName) => {
  const slug = orgName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6)
    .padEnd(3, "X");
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `TEN-${slug}-${suffix}`;
};

/**
 * Generates a secure random password for system-created accounts.
 * Format: 12 chars, mix of upper/lower/digits/symbols
 */
export const generatePassword = () => {
  const chars =
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$!";
  let pass = "";
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
};

/**
 * Creates a hashed version of the given password.
 */
export const hashPassword = async (plain) => {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(plain, salt);
};

/**
 * Converts org name to subdomain slug.
 * e.g., "CBIT Hyderabad" → "cbit-hyderabad"
 */
export const nameToSubdomain = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 30);
};