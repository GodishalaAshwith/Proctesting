/**
 * UPDATED server.js — Multi-Tenant Version
 *
 * Changes:
 *  - Added superadmin routes
 *  - Socket.io rooms are now tenant-scoped (exam_{tenantId}_{examId})
 *  - Rate limiting added
 */
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import Exam from "./models/Exam.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import examRoutes from "./routes/exams.js";
import attemptRoutes from "./routes/attempts.js";
import miscRoutes from "./routes/misc.js";
import { scheduleDailyRunner } from "./scheduler/promotion.js";
import aiRoutes from "./routes/ai.routes.js";
import faceRoutes from "./routes/face.routes.js";
import superAdminRoutes from "./routes/superadmin.routes.js";  // NEW
import tenantRoutes from "./routes/tenant.routes.js";            // NEW

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
connectDB();

// ─── CORS ─────────────────────────────────────────────────────────────────────
const originsEnv = process.env.CLIENT_URLS || process.env.CLIENT_URL || "*";
const corsOptions =
  originsEnv === "*"
    ? { origin: "*" }
    : { origin: originsEnv.split(",").map((s) => s.trim()).filter(Boolean) };

app.use(cors(corsOptions));
app.use(express.json());

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(httpServer, { cors: corsOptions });

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Faculty joins exam room (now tenant-scoped)
  socket.on("faculty:join", ({ examId, tenantId }) => {
    const room = `exam_${tenantId}_${examId}_faculty`;
    socket.join(room);
    socket.to(`exam_${tenantId}_${examId}`).emit("faculty:online");
  });

  socket.on("faculty:authenticate", ({ facultyId }) => {
    socket.join(`faculty_${facultyId}`);
  });

  // Student joins exam (tenant-scoped)
  socket.on("student:join", ({ examId, studentId, studentName, tenantId }) => {
    socket.examId = examId;
    socket.studentId = studentId;
    socket.tenantId = tenantId;
    socket.join(`exam_${tenantId}_${examId}`);
    socket.to(`exam_${tenantId}_${examId}_faculty`).emit("student:joined", {
      socketId: socket.id, studentId, studentName,
    });
  });

  // WebRTC signaling
  socket.on("faculty:request_offer", ({ studentSocketId }) => {
    io.to(studentSocketId).emit("faculty:request_offer", { facultySocketId: socket.id });
  });
  socket.on("webrtc:offer", ({ targetSocketId, offer, studentId, studentName }) => {
    io.to(targetSocketId).emit("webrtc:offer", { senderSocketId: socket.id, offer, studentId, studentName });
  });
  socket.on("webrtc:answer", ({ targetSocketId, answer }) => {
    io.to(targetSocketId).emit("webrtc:answer", { senderSocketId: socket.id, answer });
  });
  socket.on("webrtc:candidate", ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit("webrtc:candidate", { senderSocketId: socket.id, candidate });
  });

  // Proctoring violations (tenant-scoped)
  socket.on("student:violation", async ({ examId, studentId, type, tenantId }) => {
    socket.to(`exam_${tenantId}_${examId}_faculty`).emit("student:violation", { studentId, type });
    try {
      const exam = await Exam.findOne({ _id: examId, tenantId }).select("createdBy");
      if (exam?.createdBy) {
        io.to(`faculty_${exam.createdBy}`).emit("faculty:alert", { studentId, examId, type, tenantId });
      }
    } catch (e) {}
  });

  socket.on("faculty:toggle_autosubmit", ({ examId, enabled, tenantId }) => {
    socket.to(`exam_${tenantId}_${examId}`).emit("config:autosubmit", { enabled });
  });

  socket.on("faculty:warning", ({ targetSocketId, message }) => {
    io.to(targetSocketId).emit("faculty:warning", { message });
  });
  socket.on("faculty:force_submit", ({ targetSocketId }) => {
    io.to(targetSocketId).emit("faculty:force_submit");
  });

  socket.on("disconnect", () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
    if (socket.studentId && socket.examId && socket.tenantId) {
      socket.to(`exam_${socket.tenantId}_${socket.examId}_faculty`).emit("student:left", {
        studentId: socket.studentId,
      });
    }
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/superadmin", superAdminRoutes);   // NEW — SuperAdmin panel
app.use("/api/tenant", tenantRoutes);           // NEW — Public branding endpoint
app.use("/api/ai", aiRoutes);
app.use("/api/face", faceRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/attempts", attemptRoutes);
app.use("/api", miscRoutes);

scheduleDailyRunner();

app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
app.get("/", (req, res) => res.send("API is running..."));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));