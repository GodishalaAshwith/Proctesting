import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

let model = null;

function getModel() {
  if (!model) {
    model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash-lite",
      temperature: 0.2,
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

export async function analyzeIntent(input) {
  const messages = [
    new SystemMessage(`
You are an academic intent analyzer.
Extract structured information from the input.

Return JSON only:
{
  "topic": "",
  "difficulty": "",
  "questionType": "",
  "numQuestions": number
}
    `),
    new HumanMessage(input),
  ];

  const response = await getModel().invoke(messages);

  return safeParse(response.content);
}
