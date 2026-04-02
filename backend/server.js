import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import examRoutes from "./routes/exams.js";
import attemptRoutes from "./routes/attempts.js";
import miscRoutes from "./routes/misc.js";
import { scheduleDailyRunner } from "./scheduler/promotion.js";
import aiRoutes from "./routes/ai.routes.js";
import faceRoutes from "./routes/face.routes.js";



dotenv.config(); // Load environment variables

const app = express();
connectDB(); // Connect to MongoDB

// Middleware
// Allow one or more frontend origins via env: CLIENT_URLS (comma-separated) or CLIENT_URL; defaults to '*'
const originsEnv = process.env.CLIENT_URLS || process.env.CLIENT_URL || "*";
const corsOptions =
  originsEnv === "*"
    ? { origin: "*" }
    : {
        origin: originsEnv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
app.use(cors(corsOptions)); // Allow frontend to connect
app.use(express.json()); // Parse JSON body

// Routes
app.use("/api/ai", aiRoutes);
app.use("/api/face", faceRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/attempts", attemptRoutes);
app.use("/api", miscRoutes);

// Schedule academic promotion cycles (semester/year)
scheduleDailyRunner();

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Default route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port https://localhost:${PORT}`));
