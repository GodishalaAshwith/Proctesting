import sys
import json
from pydantic import BaseModel, Field
from typing import List
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
import os
from dotenv import load_dotenv

# Load .env from backend folder
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

# Ensure the API key is available
if not os.environ.get("GOOGLE_API_KEY"):
    raise ValueError("GOOGLE_API_KEY environment variable is not set.")


# Define Pydantic models for structured output
class Intent(BaseModel):
    topic: str = Field(description="The topic of the questions")
    difficulty: str = Field(description="The difficulty level of the questions")
    questionType: str = Field(description="The type of questions to generate")
    numQuestions: int = Field(description="The number of questions to generate")

class Question(BaseModel):
    question: str = Field(description="The question text")
    options: List[str] = Field(description="List of options for multiple choice questions, if applicable")
    correctAnswerIndex: int = Field(description="The index of the correct answer in the options array (0-based)")
    difficulty: str = Field(description="The difficulty of this specific question")

class QuestionsResult(BaseModel):
    questions: List[Question]

def analyze_intent(llm, prompt: str) -> Intent:
    structured_llm = llm.with_structured_output(Intent)
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an academic intent analyzer.\nExtract structured information from the input.\nReturn accurate JSON mapping to the requested schema."),
        ("human", "{prompt}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({"prompt": prompt})

def generate_questions(llm, intent: Intent) -> QuestionsResult:
    structured_llm = llm.with_structured_output(QuestionsResult)
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an academic question generator.\nGenerate questions following the provided topic, difficulty, type, and number."),
        ("human", "Topic: {topic}\nDifficulty: {difficulty}\nType: {questionType}\nNumber of Questions: {numQuestions}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({
        "topic": intent.topic,
        "difficulty": intent.difficulty,
        "questionType": intent.questionType,
        "numQuestions": intent.numQuestions
    })

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No prompt provided"}))
        sys.exit(1)
        
    prompt = sys.argv[1]
    
    try:
        # Initialize Gemini model
        llm_intent = ChatGoogleGenerativeAI(model="gemini-2.5-flash-lite", temperature=0.2)
        llm_gen = ChatGoogleGenerativeAI(model="gemini-2.5-flash-lite", temperature=0.7)
        
        # Run agent pipeline
        intent = analyze_intent(llm_intent, prompt)
        questions_result = generate_questions(llm_gen, intent)
        
        # Format out
        output = {
            "intent": intent.model_dump(),
            "questions": [q.model_dump() for q in questions_result.questions]
        }
        
        print(json.dumps(output))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
