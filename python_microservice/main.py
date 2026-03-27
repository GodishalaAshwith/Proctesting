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


@app.post("/proctor-check/{student_id}")
async def proctor_check(student_id: str, file: UploadFile = File(...)):
    """
    Periodic proctoring check during an exam session.
    Returns a normalized violation_type alongside the raw verify_face result:
      - "none"           → face matches registered student, all clear
      - "no_face"        → no face detected in frame (student may have moved away)
      - "wrong_face"     → exactly one face but it does not match the registered student
      - "multiple_faces" → more than one face visible in frame
    """
    suffix = os.path.splitext(file.filename)[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        temp_path = tmp.name

    try:
        result = verify_face(temp_path, student_id)
    finally:
        os.unlink(temp_path)

    # Determine violation type from the raw result
    face_count = result.get("face_count", None)
    status = result.get("status", "")
    matched = result.get("match", False)

    if status == "error":
        if face_count == 0:
            violation_type = "no_face"
        elif face_count is not None and face_count > 1:
            violation_type = "multiple_faces"
        else:
            # e.g. not registered or embedding error — treat as no_face
            violation_type = "no_face"
    elif matched:
        violation_type = "none"
    else:
        violation_type = "wrong_face"

    return {**result, "violation_type": violation_type}


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