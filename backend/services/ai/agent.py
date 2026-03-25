import sys
import json
from pydantic import BaseModel, Field
from typing import List
from langchain_core.prompts import ChatPromptTemplate
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_community.vectorstores import FAISS
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
from dotenv import load_dotenv

# Load .env from backend folder
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

# Google API Key check removed - local model in use

# Define Pydantic models for structured output
class Intent(BaseModel):
    topic: str = Field(description="The topic(s) of the questions. If none specified by user, use 'general content'. If multiple, combine them.")
    difficulty: str = Field(description="The difficulty level of the questions")
    questionType: str = Field(description="The type of questions to generate")
    numQuestions: int = Field(description="The TOTAL number of questions to generate. If not specified, default to 5.")

class Question(BaseModel):
    question: str = Field(description="The question text")
    options: List[str] = Field(description="List of options for multiple choice questions, if applicable")
    correctAnswerIndex: int = Field(description="The index of the correct answer in the options array (0-based)")
    difficulty: str = Field(description="The difficulty of this specific question")

class QuestionsResult(BaseModel):
    questions: List[Question]

def get_or_build_vector_store():
    # Paths for textbooks and the FAISS index
    base_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(base_dir, "..", "..")
    textbooks_dir = os.path.join(backend_dir, "textbooks")
    faiss_index_dir = os.path.join(backend_dir, "faiss_index")
    
    embeddings = OllamaEmbeddings(model="all-minilm", base_url="http://127.0.0.1:11434")
    
    # Try loading existing FAISS index
    if os.path.exists(faiss_index_dir):
        try:
            return FAISS.load_local(faiss_index_dir, embeddings, allow_dangerous_deserialization=True)
        except Exception as e:
            # Rebuild if it fails to load
            print(f"Failed to load FAISS index: {e}, rebuilding...", file=sys.stderr)
            pass

    # Build the FAISS index from the documents
    os.makedirs(textbooks_dir, exist_ok=True)
    documents = []
    
    for root, _, files in os.walk(textbooks_dir):
        for file in files:
            file_path = os.path.join(root, file)
            try:
                if file.endswith('.pdf'):
                    doc_loader = PyPDFLoader(file_path)
                    documents.extend(doc_loader.load())
                elif file.endswith('.txt') or file.endswith('.md'):
                    doc_loader = TextLoader(file_path, encoding='utf-8')
                    documents.extend(doc_loader.load())
            except Exception as e:
                print(f"Error loading {file_path}: {e}", file=sys.stderr)
    
    if not documents:
        return None  # No documents loaded
    
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    splits = text_splitter.split_documents(documents)
    
    vector_store = FAISS.from_documents(splits, embeddings)
    vector_store.save_local(faiss_index_dir)
    return vector_store

def analyze_intent(llm, prompt: str) -> Intent:
    structured_llm = llm.with_structured_output(Intent)
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an academic intent analyzer.\nExtract structured information from the input.\nIf no specific topic is mentioned, use 'general content' as the topic.\nIf multiple topics are requested (e.g. '5 trig and 5 bio'), COMBINE them into a single string for `topic`.\nCRITICALLY: set `numQuestions` to the TOTAL sum exactly requested (e.g. 5 + 5 = 10). If no number is specified, default to 5.\nReturn accurate JSON mapping to the requested schema."),
        ("human", "{prompt}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({"prompt": prompt})

def check_relevance(llm, topic: str, context: str) -> bool:
    if topic.lower() in ["general", "general content", "various", "any"]:
        return True
        
    system_prompt = (
        "You are an academic context evaluator.\n"
        f"Read the provided CONTEXT from a textbook.\n"
        f"Determine if the CONTEXT contains ANY relevant information about the requested topic '{topic}'.\n"
        "If the context is completely unrelated, return NO.\n"
        "If the context is relevant, return YES.\n"
        "Answer ONLY with YES or NO. Do not explain your answer."
    )
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "CONTEXT:\n{context}")
    ])
    
    try:
        # Avoid structured output for relevance checks on 1B parameter models
        result = llm.invoke(chat_prompt.format(context=context))
        print(f"DEBUG RELEVANCE OUTPUT: {result.content}", file=sys.stderr)
        
        answer = result.content.strip().lower()
        return answer.startswith("yes") or "yes" in answer
    except Exception as e:
        print(f"Relevance check parsing failed: {e}", file=sys.stderr)
        return False

def generate_questions(llm, intent: Intent, original_prompt: str, context: str) -> QuestionsResult:
    structured_llm = llm.with_structured_output(QuestionsResult)
    
    system_prompt = (
        "You are a rigorous academic question generator.\n"
        "Generate EXACTLY {numQuestions} questions strictly based ONLY on the provided CONTEXT.\n"
        "NEVER use outside knowledge. NEVER invent fictional scenarios (e.g., 'Martian Flying Squirrel').\n"
        "If the topic is generic like 'general content', create questions covering the key concepts actually present in the CONTEXT.\n\n"
        "CONTEXT:\n{context}"
    )
    
    chat_prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "User's Original Prompt: {original_prompt}\nParsed Topic: {topic}\nDifficulty: {difficulty}\nType: {questionType}\nTotal Number of Questions: {numQuestions}")
    ])
    
    chain = chat_prompt | structured_llm
    return chain.invoke({
        "original_prompt": original_prompt,
        "topic": intent.topic,
        "difficulty": intent.difficulty,
        "questionType": intent.questionType,
        "numQuestions": intent.numQuestions,
        "context": context
    })

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No prompt provided"}))
        sys.exit(1)
        
    prompt = sys.argv[1]
    
    try:
        # Initialize Ollama model
        llm_intent = ChatOllama(model="llama3.2:latest", temperature=0.2, base_url="http://127.0.0.1:11434")
        llm_gen = ChatOllama(model="llama3.2:latest", temperature=0.7, base_url="http://127.0.0.1:11434")
        
        # Build or load vector store
        vector_store = get_or_build_vector_store()
        context_str = ""
        
        # Ensure intent is parsed
        intent = analyze_intent(llm_intent, prompt)
        
        # Retrieve context from textbooks if vector store exists
        if vector_store is not None:
            retriever = vector_store.as_retriever(search_kwargs={"k": 5})
            # Use intent.topic to search the textbook unless it's generic
            search_query = prompt if intent.topic.lower() in ["general", "general content", "various", "any"] else f"{intent.topic} {prompt}"
            docs = retriever.invoke(search_query)
            context_str = "\n\n".join([doc.page_content for doc in docs])
        else:
            # If no textbooks provided, fallback or empty context
            context_str = "No textbook context available."
            
        # Explicit textual relevance verification step
        if not context_str.strip() or context_str == "No textbook context available.":
            print(json.dumps({"error": "Relevant data is not in datastore. Please add textbook content for this topic before generating questions."}))
            sys.exit(0)
            
        print(f"DEBUG: Retrieved Context length = {len(context_str)}", file=sys.stderr)
        
        is_relevant = check_relevance(llm_intent, intent.topic, context_str)
        if not is_relevant:
            print(json.dumps({"error": f"Relevant data for '{intent.topic}' is not in datastore. Please add textbook content for this topic before generating questions."}))
            sys.exit(0)
            
        # Run generative agent Pipeline
        questions_result = generate_questions(llm_gen, intent, prompt, context_str)
            
        output = {
            "intent": intent.model_dump(),
            "questions": [q.model_dump() for q in questions_result.questions]
        }
        
        print(json.dumps(output))
        
    except Exception as e:
        import traceback
        error_msg = str(e) if str(e) else repr(e)
        print(json.dumps({"error": f"{error_msg}. Trace: {traceback.format_exc()}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
