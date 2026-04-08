# ProcteredMERN Project Report

Date: April 8, 2026

## 1. Project Summary

ProcteredMERN is a full-stack online examination and proctoring platform built with:
- MERN stack (MongoDB, Express, React, Node.js)
- A Python FastAPI microservice for face and gaze analysis
- Socket.IO + WebRTC for live faculty monitoring
- AI-assisted question generation through an Ollama/LangChain pipeline

The system supports role-based workflows for:
- Admin
- Faculty
- Student

It includes exam authoring, assignment-based delivery, timed attempts, anti-cheat event logging, live invigilation, retake controls, bulk student roster upload, and contact/email functionality.

## 2. High-Level Architecture

### Frontend (React + Vite)
- Role-based routes and guarded pages
- Pages for admin/faculty/student workflows
- Exam runner with proctoring controls and autosave
- Faculty live view with real-time student streams and violation alerts

### Backend (Express + MongoDB)
- JWT authentication and role authorization
- REST APIs for auth, admin, exams, attempts, proctoring, AI, and contact
- Socket.IO signaling for live proctoring
- Scheduler for semester/year promotion cycles

### Python Microservice (FastAPI)
- Face registration and face verification endpoints
- Proctoring classification (no face / wrong face / multiple faces)
- Gaze tracking session endpoints (frame, summary, end, active)

### AI Service
- Node orchestrator executes Python AI agent
- AI agent uses local Ollama models + FAISS textbook retrieval
- Generates structured questions from context-limited source material

## 3. Implemented Features (By User Role)

## 3.1 Admin Features

1. Faculty account management
- Create faculty users with name/email/password
- List all faculty users

2. User and roster directory management
- Separate directory views:
  - Accounts (User documents)
  - Students (roster directory)
  - Faculty
- Filter by role, search, college, department, section, year, semester
- Edit account fields (name, email, roll no, college, department, section, year, semester where applicable)
- Reset account password (to roll number when available)

3. Bulk student upload
- Upload CSV/XLS/XLSX files
- Header normalization and row validation
- Creates Student roster records
- Tracks created/skipped/errors per upload
- Downloadable student upload template provided in frontend public assets

## 3.2 Faculty Features

1. Exam management
- Create exam
- Edit exam
- Delete exam
- List own exams

2. Advanced exam editor
- Question types:
  - Single choice
  - Multiple choice
  - Text/manual grading
- Question operations:
  - Add, duplicate, remove
  - Option add/remove
  - Correct answer selection
- Exam metadata:
  - Title, description, duration
  - Window start/end scheduling
- Assignment criteria:
  - College
  - Year list
  - Department list
  - Section list
  - Semester list

3. Question ingestion workflows
- Import from pasted/file content:
  - CSV/TSV (Google Sheets style)
  - Text block format (Google Docs style)
- Replace existing questions or append imported ones
- AI-based question generation from prompt
- Autofill exam form from previously created exams

4. Submissions and review
- View all attempts for an exam
- View score/status/violation count/student info
- Open detailed proctoring event timeline per attempt
- Grant retake counts to specific students

5. Export capabilities
- CSV export of submissions
- Excel export (.xlsx) of submissions
- Current export format in implementation focuses on:
  - RollNo
  - Marks

6. Live proctoring view
- Real-time student stream monitoring via WebRTC
- Pinned student focus mode
- Violation alerts in live grid
- Event log timeline per student
- Faculty control to toggle auto-submit behavior for students (propagated via Socket.IO)

## 3.3 Student Features

1. Authentication modes
- Student login directly from roster (rollno/email + rollno as default password)
- User-model login path also supported for students/faculty/admin

2. Dashboard and exam discovery
- Role-specific dashboard cards and summaries
- Available exams list with upcoming/active distinctions
- Countdown and exam window awareness

3. Exam taking workflow
- Start/resume attempt
- Timed exam session
- Autosave answers at intervals
- Submit with confirmation
- Submitted result summary with manual grading flag

4. Proctoring protections during exam
- Fullscreen enforcement
- Tab visibility and window focus monitoring
- Window resize suspicious behavior detection
- Keyboard shortcut blocking (copy/cut/print/save/select-all best effort)
- Context menu and text selection restrictions
- Before-unload warning while attempt is active

5. Camera-based verification and monitoring
- Face capture required before exam start
- Continuous face checks during attempt
- Continuous gaze checks during attempt
- On-screen proctoring status indicator and violation overlays

6. Student profile
- Read-only profile view pulled from roster-linked data

## 4. Proctoring and Anti-Cheat Implementation

### 4.1 Event Types Stored
Implemented violation/event types include:
- tab-blur
- visibility-hidden
- fullscreen-exit
- return-timeout
- window-resize
- face-absent
- face-mismatch
- face-multiple
- gaze-away
- gaze-no-face

### 4.2 Data Recording
Proctoring events are persisted in two places:
- `Attempt.violations` summary array
- `ProctoringEvent` dedicated collection for timeline queries

### 4.3 Auto-Submit Behavior
- Exam runner tracks serious violations and can auto-submit after configured thresholds
- Faculty can toggle auto-submit in live proctor dashboard and broadcast setting to active student sessions

### 4.4 Device-Aware Proctoring Tiers
Client-side device evaluation assigns tiers:
- full
- snapshot
- event-only

Tier is sent to backend and stored per attempt.

## 5. Exam/Attempt Lifecycle Features

1. Exam availability
- Student can fetch exams where current time is within not-ended windows and assignment criteria match

2. Attempt creation and restart rules
- Start attempt when exam window is active
- Existing in-progress attempt reused
- Expired in-progress attempts can be marked invalid
- Retake tokens allow new attempts after submitted/invalid states

3. Save and submit
- Save endpoint merges answer snapshots while in-progress and before expiry
- Submit endpoint finalizes attempt and performs scoring

4. Scoring logic
- Single-choice: exact match to single correct index
- MCQ: set equality against correct indexes
- Text: excluded from auto-scoring; triggers `manualNeeded`

## 6. Authentication and Authorization

1. JWT auth
- Backend issues JWT tokens with role and principal model details
- Auth middleware validates token and role gates routes

2. Role guarding
- Express role checks for admin/faculty/student APIs
- React route guards (`PrivateRoute`, `RoleRoute`) enforce frontend access control

3. Dual student identity model
- `User` model for authenticated accounts
- `Student` model for roster-only identities
- Attempts support dynamic ref (`User` or `Student`) via `studentRef` + `studentId`

## 7. Data Model Design (MongoDB/Mongoose)

1. User
- Account identity and role (student/faculty/admin)
- Academic fields for applicable roles

2. Student
- Roster directory with roll no and academic profile
- Promotion cycle guard fields (`lastSemCycle`, `lastYearCycle`)

3. Exam
- Metadata, duration, start/end window
- Question array with validation hooks
- Assignment criteria filters
- Retake grants per student

4. Attempt
- Links to exam and dynamic student principal
- Status lifecycle and timestamps
- Answers, score, manualNeeded
- Device info and proctoring tier
- Violation summary

5. ProctoringEvent
- Event timeline with type, timestamp, metadata

## 8. API Surface (Implemented)

### Auth
- POST /api/auth/register
- POST /api/auth/login-user
- POST /api/auth/login-student
- GET /api/auth/user
- PUT /api/auth/profile
- POST /api/auth/change-password

### Admin
- POST /api/admin/faculty
- GET /api/admin/faculty
- GET /api/admin/users
- PATCH /api/admin/users/:id
- POST /api/admin/users/:id/reset-password
- GET /api/admin/students
- POST /api/admin/students/upload

### Exams
- POST /api/exams
- GET /api/exams
- GET /api/exams/available
- GET /api/exams/:id
- PUT /api/exams/:id
- DELETE /api/exams/:id

### Attempts
- POST /api/attempts/start
- POST /api/attempts/save
- POST /api/attempts/submit
- GET /api/attempts/:id
- POST /api/attempts/:id/proctor
- GET /api/attempts/:id/events
- GET /api/attempts/exam/:examId/attempts
- POST /api/attempts/exam/:examId/grant-retake

### Face/Gaze Proxy
- POST /api/face/register/:studentId
- POST /api/face/check/:studentId
- GET /api/face/gaze/active
- POST /api/face/gaze/frame/:studentId
- GET /api/face/gaze/summary/:studentId
- POST /api/face/gaze/end/:studentId

### AI
- POST /api/ai/test-agent
- POST /api/ai/generate-questions

### Misc
- POST /api/contact
- GET /health
- GET /

## 9. Real-Time and Streaming Features

1. Socket.IO channels/events
- Faculty join exam rooms
- Student join exam rooms
- Violation forwarding from student to faculty room
- Auto-submit config broadcast from faculty to students
- WebRTC signaling relay:
  - faculty:request_offer
  - webrtc:offer
  - webrtc:answer
  - webrtc:candidate

2. WebRTC
- Student streams camera feed to faculty during active exam monitoring
- Faculty dashboard can pin and monitor selected student feeds

## 10. AI Question Generation Details

1. Input and orchestration
- Frontend sends prompt to `/api/ai/generate-questions`
- Node orchestrator executes Python `agent.py` using virtualenv Python executable

2. Retrieval + generation pipeline
- FAISS index built/loaded from textbook content
- Topic extraction and intent parsing
- Relevance checks against available content
- Structured generation of questions with options and answer index

3. Guardrails in current implementation
- If relevant topic/data missing in datastore, pipeline returns an error instead of hallucinating from unrelated context

## 11. Scheduling/Automation Features

Automatic academic promotion runner:
- Runs at backend startup and then every 12 hours
- Semester/year increment logic with cycle guards
- January/July cycle tagging to avoid duplicate promotions

## 12. Contact and Email Features

1. Public contact endpoint
- Validates name/email/message
- Sends message via Brevo transactional email API
- Configurable sender and receiver via env vars

2. Frontend contact page
- Developer profile information
- Contact form submission status handling

## 13. Deployment and Environment

1. Deployment artifacts present
- `render.yaml` for backend + frontend Render services
- `vercel.json` in frontend
- Deployment guides (`DEPLOYMENT.md`, `QUICK-DEPLOY.md`)

2. Root dev orchestration
- Root script runs frontend, backend, python microservice, and Ollama concurrently

3. Key environment-driven integrations
- MongoDB URI
- JWT secret
- CORS client URL(s)
- Face service URL
- Brevo API key and mail settings
- Frontend API base URL

## 14. Tech Stack Snapshot

### Frontend
- React 18, Vite, React Router
- Axios
- Tailwind CSS v4
- Lucide icons, AOS animations
- XLSX for exports
- Socket.IO client

### Backend
- Express, Mongoose
- JWT, bcryptjs
- Multer, node-fetch, form-data
- Socket.IO
- XLSX
- Brevo SDK

### Python
- FastAPI, Uvicorn
- OpenCV, NumPy, MediaPipe
- face-recognition/dlib

### AI Services
- LangChain
- Ollama local models
- FAISS vector index

## 15. Current Functional Scope and Notes

1. Strongly implemented areas
- Multi-role workflow and access control
- Exam authoring + assignment criteria
- Timed attempts with autosave and scoring
- Face + gaze proctor event flow
- Real-time faculty live invigilation with WebRTC
- Admin bulk roster upload and account management
- AI-assisted question generation from textbook datastore

2. Practical implementation notes
- Contact uses Brevo API key; without it, endpoint returns config error
- Frontend env variable naming appears in multiple forms in docs and code (`VITE_API_BASE`, `VITE_API_BASE_URL`); align during deployment to avoid mismatched base URLs
- Student profile is read-only in current UI (roster-managed)
- No automated test suite is currently defined in project scripts

## 16. Conclusion

This project is an implemented, production-oriented proctored exam platform with:
- End-to-end exam lifecycle management
- Role-specific dashboards and controls
- Layered anti-cheat protections
- Real-time live proctoring
- AI-assisted exam authoring
- Supporting admin and deployment workflows

Overall, the codebase already contains substantial functionality across security, usability, and operational tooling, and can be further extended with automated tests, analytics, and deeper grading workflows.
