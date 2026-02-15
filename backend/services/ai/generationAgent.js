import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

let model = null;

function getModel() {
  if (!model) {
    model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash-lite",
      temperature: 0.7,
      apiKey: process.env.GOOGLE_API_KEY,
    });
  }
  return model;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

export async function generateQuestions(intent) {
  const messages = [
    new SystemMessage(`
You are an academic question generator.
Generate questions in structured JSON format only.

Return:
{
  "questions": [
    {
      "question": "",
      "options": [],
      "correctAnswerIndex": number,
      "difficulty": ""
    }
  ]
}
    `),
    new HumanMessage(`
Topic: ${intent.topic}
Difficulty: ${intent.difficulty}
Type: ${intent.questionType}
Number of Questions: ${intent.numQuestions}
    `),
  ];

  const response = await getModel().invoke(messages);

  return safeParse(response.content);
}
