import sys
import json
from pydantic import BaseModel, Field
from typing import List
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama
import os
from dotenv import load_dotenv

# Load .env from backend folder
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

# Google API Key check removed - local model in use

# Define Pydantic models for structured output
class Intent(BaseModel):
    topic: str = Field(description="The topic(s) of the questions. If multiple topics are requested, combine them.")
    difficulty: str = Field(description="The difficulty level of the questions")
    questionType: str = Field(description="The type of questions to generate")
    numQuestions: int = Field(description="The TOTAL number of questions to generate across all topics. E.g., '5 of X and 5 of Y' -> 10.")

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
        ("system", "You are an academic intent analyzer.\nExtract structured information from the input.\nIf multiple topics are requested (e.g. '5 trig and 5 bio'), COMBINE them into a single string for `topic`.\nCRITICALLY: set `numQuestions` to the TOTAL sum exactly requested (e.g. 5 + 5 = 10).\nReturn accurate JSON mapping to the requested schema."),
        ("human", "{prompt}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({"prompt": prompt})

def generate_questions(llm, intent: Intent, original_prompt: str) -> QuestionsResult:
    structured_llm = llm.with_structured_output(QuestionsResult)
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an academic question generator.\nGenerate questions following the exact constraints from the User's Original Prompt. Distribute exact counts per topic as requested.\nYou MUST generate EXACTLY {numQuestions} questions in total. Do not generate more or less."),
        ("human", "User's Original Prompt: {original_prompt}\nParsed Topic: {topic}\nDifficulty: {difficulty}\nType: {questionType}\nTotal Number of Questions: {numQuestions}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({
        "original_prompt": original_prompt,
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
        # Initialize Ollama model
        llm_intent = ChatOllama(model="llama3.2:latest", temperature=0.2)
        llm_gen = ChatOllama(model="llama3.2:latest", temperature=0.7)
        
        # Run agent pipeline
        intent = analyze_intent(llm_intent, prompt)
        questions_result = generate_questions(llm_gen, intent, prompt)
        
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
