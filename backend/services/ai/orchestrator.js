import { analyzeIntent } from "./intentAgent.js";
import { generateQuestions } from "./generationAgent.js";

export async function runAgentPipeline(input) {
  const intent = await analyzeIntent(input);

  const questions = await generateQuestions(intent);

  return {
    intent,
    ...questions,
  };
}
