import express from "express";
import { runAgentPipeline } from "../services/ai/orchestrator.js";

const router = express.Router();

router.post("/test-agent", async (req, res) => {
  try {
    const { prompt } = req.body;

    const result = await runAgentPipeline(prompt);

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Agent failed" });
  }
});

export default router;
