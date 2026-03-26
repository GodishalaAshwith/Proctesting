from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from fastapi import FastAPI, UploadFile, File
from utils.face_db import init_db, register_face, verify_face, list_students, delete_student, proctor_check
import tempfile
import os

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # allow all origins (dev only)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RequestData(BaseModel):
    text: str


@app.on_event("startup")
def startup():
    init_db()  # creates the DB table on app start

@app.post("/register/{student_id}")
async def register(student_id: str, file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = tmp.name
    # file is closed here — now safe to read on Windows

    try:
        result = register_face(temp_path, student_id)
    finally:
        os.unlink(temp_path)

    return result


@app.post("/verify/{student_id}")
async def verify(student_id: str, file: UploadFile = File(...)):
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = tmp.name

    try:
        result = verify_face(temp_path, student_id)
    finally:
        os.unlink(temp_path)

    return result

@app.get("/students")
def students():
    return list_students()

@app.delete("/students/{student_id}")
def delete(student_id: str):
    return delete_student(student_id)

@app.post("/proctor/check/{student_id}")
async def proctor_check_endpoint(
    student_id: str,
    file: UploadFile = File(...),
    run_reverify: bool = False       # passed as query param: ?run_reverify=true
):
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = tmp.name

    try:
        result = proctor_check(temp_path, student_id, run_reverify=run_reverify)
    finally:
        os.unlink(temp_path)

    return result