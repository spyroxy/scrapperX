import os
import json
import uuid
import asyncio
from typing import Dict, Any, List
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, status, BackgroundTasks
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.scraper import run_scraper
from backend.excel_gen import generate_excel
from backend.robot_runner import execute_robot_script

app = FastAPI(title="ScraperX API")

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS_DIR = os.path.join(os.path.dirname(__file__), "jobs")
os.makedirs(JOBS_DIR, exist_ok=True)

ROBOTS_DIR = os.path.join(os.path.dirname(__file__), "robots")
os.makedirs(ROBOTS_DIR, exist_ok=True)

# In-memory store for running job/robot logs & progress
job_states: Dict[str, Dict[str, Any]] = {}
robot_states: Dict[str, Dict[str, Any]] = {}

# Active WebSocket connections
active_connections: Dict[str, List[WebSocket]] = {}
robot_active_connections: Dict[str, List[WebSocket]] = {}

class LoginRequest(BaseModel):
    username: str
    password: str

class ScrapeField(BaseModel):
    name: str
    selector: str
    selector_type: str = "css"  # css or xpath
    is_list: bool = False
    extract_target: str = "text"  # text or attribute
    attribute_name: str = ""

class JobConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    url: str
    fields: List[ScrapeField]
    delay: int = 0  # ms
    timeout: int = 30000  # ms
    max_pages: int = 5
    wait_condition: str = "domcontentloaded"  # networkidle, domcontentloaded, selector_visible
    user_agent: str = ""
    headers: Dict[str, str] = {}
    pagination_type: str = "none"  # none, next_button, url_pattern, infinite_scroll
    next_button_selector: str = ""
    url_pattern: str = ""
    # Target Site Authentication (Optional)
    login_url: str = ""
    login_username_selector: str = ""
    login_username_value: str = ""
    login_password_selector: str = ""
    login_password_value: str = ""
    login_submit_selector: str = ""

class RobotConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: str = ""
    script_code: str

# Helper to load all jobs
def get_all_jobs_list() -> List[Dict[str, Any]]:
    jobs = []
    for filename in os.listdir(JOBS_DIR):
        if filename.endswith(".json"):
            try:
                with open(os.path.join(JOBS_DIR, filename), "r") as f:
                    jobs.append(json.load(f))
            except Exception:
                pass
    return jobs

# 1. AUTHENTICATION (Hardcoded login, no JWT)
@app.post("/api/login")
async def login(req: LoginRequest):
    if req.username == "admin" and req.password == "password123":
        return {"status": "success", "token": "dummy-hardcoded-token-session", "username": "admin"}
    raise HTTPException(status_code=401, detail="Invalid username or password")

# 2. CRUD JOBS
@app.get("/api/jobs")
async def get_jobs():
    return get_all_jobs_list()

@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
    with open(file_path, "r") as f:
        return json.load(f)

@app.post("/api/jobs")
async def create_job(job: JobConfig):
    file_path = os.path.join(JOBS_DIR, f"{job.id}.json")
    # Initialize state
    job_states[job.id] = {
        "status": "pending",
        "logs": [],
        "data": []
    }
    with open(file_path, "w") as f:
        json.dump(job.model_dump(), f, indent=2)
    return job

@app.put("/api/jobs/{job_id}")
async def update_job(job_id: str, job: JobConfig):
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
    # Make sure ID matches
    job.id = job_id
    print(f"DEBUG update_job: {job.model_dump()}")
    with open(file_path, "w") as f:
        json.dump(job.model_dump(), f, indent=2)
    return job

@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str):
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
    os.remove(file_path)
    if job_id in job_states:
        del job_states[job_id]
    return {"status": "deleted"}

# 3. IMPORT/EXPORT CONFIG
@app.post("/api/jobs/import")
async def import_job(job: JobConfig):
    # Generates a new ID to prevent duplication conflicts or preserve as needed
    job.id = str(uuid.uuid4())
    file_path = os.path.join(JOBS_DIR, f"{job.id}.json")
    with open(file_path, "w") as f:
        json.dump(job.model_dump(), f, indent=2)
    return job

# 4. WEBSOCKET FOR LOG STREAMING
@app.websocket("/ws/logs/{job_id}")
async def websocket_logs(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in active_connections:
        active_connections[job_id] = []
    active_connections[job_id].append(websocket)
    
    # Send existing state/logs immediately
    state = job_states.get(job_id, {"status": "pending", "logs": []})
    await websocket.send_json({
        "type": "init",
        "status": state.get("status", "pending"),
        "logs": state.get("logs", [])
    })
    
    try:
        while True:
            # Keep connection alive & listen to client messages if any (like Stop command)
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("command") == "stop":
                    # Mark state as error/stopped
                    if job_id in job_states:
                        job_states[job_id]["status"] = "error"
                        await broadcast_log(job_id, "Scraping stopped by user request.")
                        await broadcast_status(job_id, "error")
            except Exception:
                pass
    except WebSocketDisconnect:
        active_connections[job_id].remove(websocket)

async def broadcast_log(job_id: str, log_message: str):
    # Append to state
    if job_id not in job_states:
        job_states[job_id] = {"status": "pending", "logs": [], "data": []}
    job_states[job_id]["logs"].append(log_message)
    
    # Send to active ws
    if job_id in active_connections:
        for ws in active_connections[job_id]:
            try:
                await ws.send_json({
                    "type": "log",
                    "message": log_message
                })
            except Exception:
                pass

async def broadcast_status(job_id: str, status: str):
    if job_id not in job_states:
        job_states[job_id] = {"status": "pending", "logs": [], "data": []}
    job_states[job_id]["status"] = status
    
    if job_id in active_connections:
        for ws in active_connections[job_id]:
            try:
                await ws.send_json({
                    "type": "status",
                    "status": status
                })
            except Exception:
                pass

# 5. SCRAPING EXECUTION
def run_scrape_background(job_id: str, config_dict: Dict[str, Any], preview: bool = False):
    # Wrapper helper to run async scraping in a separate thread/task safely
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def log_cb(msg):
        asyncio.run_coroutine_threadsafe(broadcast_log(job_id, msg), loop)
        
    def status_cb(stat):
        asyncio.run_coroutine_threadsafe(broadcast_status(job_id, stat), loop)
        
    try:
        data = loop.run_until_complete(run_scraper(config_dict, log_cb, status_cb, preview=preview))
        if job_id in job_states:
            job_states[job_id]["data"] = data
    except Exception as e:
        # State already set to error by run_scraper or locally
        pass
    finally:
        loop.close()

@app.post("/api/jobs/{job_id}/scrape")
async def trigger_scrape(job_id: str, background_tasks: BackgroundTasks):
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
        
    with open(file_path, "r") as f:
        job_config = json.load(f)
        
    # Reset/init state
    job_states[job_id] = {
        "status": "pending",
        "logs": [],
        "data": []
    }
    
    background_tasks.add_task(run_scrape_background, job_id, job_config, False)
    return {"status": "started"}

@app.post("/api/jobs/{job_id}/preview")
async def trigger_preview(job_id: str, background_tasks: BackgroundTasks):
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
        
    with open(file_path, "r") as f:
        job_config = json.load(f)
        
    # Reset/init state
    job_states[job_id] = {
        "status": "pending",
        "logs": [],
        "data": []
    }
    
    background_tasks.add_task(run_scrape_background, job_id, job_config, True)
    return {"status": "started"}

@app.get("/api/jobs/{job_id}/state")
async def get_job_state(job_id: str):
    state = job_states.get(job_id, {"status": "pending", "logs": [], "data": []})
    return {
        "status": state.get("status", "pending"),
        "logs": state.get("logs", []),
        "data": state.get("data", [])
    }

# 6. DOWNLOAD EXCEL
@app.get("/api/jobs/{job_id}/download")
async def download_excel(job_id: str):
    # Fetch job configuration for metadata sheet
    file_path = os.path.join(JOBS_DIR, f"{job_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Job not found")
        
    with open(file_path, "r") as f:
        job_config = json.load(f)
        
    state = job_states.get(job_id)
    if not state or not state.get("data"):
        raise HTTPException(status_code=400, detail="No scraped data available to download. Please run the job first.")
        
    scraped_data = state["data"]
    
    metadata_info = {
        "job_id": job_id,
        "job_name": job_config.get("name"),
        "url": job_config.get("url"),
        "max_pages": job_config.get("max_pages"),
        "pagination_type": job_config.get("pagination_type"),
        "field_names": [field.get("name") for field in job_config.get("fields", [])]
    }
    
    excel_stream = generate_excel(scraped_data, metadata_info)
    
    filename = f"{job_config.get('name', 'scraped_data').replace(' ', '_')}_{job_id[:8]}.xlsx"
    
    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

# --- SELENIUM ROBOT MODULE ---
def get_all_robots_list() -> List[Dict[str, Any]]:
    robots = []
    if os.path.exists(ROBOTS_DIR):
        for filename in os.listdir(ROBOTS_DIR):
            if filename.endswith(".json"):
                try:
                    with open(os.path.join(ROBOTS_DIR, filename), "r") as f:
                        robots.append(json.load(f))
                except Exception:
                    pass
    return robots

@app.get("/api/robots")
async def get_robots():
    return get_all_robots_list()

@app.get("/api/robots/{robot_id}")
async def get_robot(robot_id: str):
    file_path = os.path.join(ROBOTS_DIR, f"{robot_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Robot not found")
    with open(file_path, "r") as f:
        return json.load(f)

@app.post("/api/robots")
async def create_robot(robot: RobotConfig):
    file_path = os.path.join(ROBOTS_DIR, f"{robot.id}.json")
    robot_states[robot.id] = {
        "status": "pending",
        "logs": []
    }
    with open(file_path, "w") as f:
        json.dump(robot.model_dump(), f, indent=2)
    return robot

@app.put("/api/robots/{robot_id}")
async def update_robot(robot_id: str, robot: RobotConfig):
    file_path = os.path.join(ROBOTS_DIR, f"{robot_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Robot not found")
    robot.id = robot_id
    with open(file_path, "w") as f:
        json.dump(robot.model_dump(), f, indent=2)
    return robot

@app.delete("/api/robots/{robot_id}")
async def delete_robot(robot_id: str):
    file_path = os.path.join(ROBOTS_DIR, f"{robot_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Robot not found")
    os.remove(file_path)
    if robot_id in robot_states:
        del robot_states[robot_id]
    return {"status": "deleted"}

@app.websocket("/ws/robots/logs/{robot_id}")
async def websocket_robot_logs(websocket: WebSocket, robot_id: str):
    await websocket.accept()
    if robot_id not in robot_active_connections:
        robot_active_connections[robot_id] = []
    robot_active_connections[robot_id].append(websocket)
    
    state = robot_states.get(robot_id, {"status": "pending", "logs": []})
    await websocket.send_json({
        "type": "init",
        "status": state.get("status", "pending"),
        "logs": state.get("logs", [])
    })
    
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        robot_active_connections[robot_id].remove(websocket)

async def broadcast_robot_log(robot_id: str, log_message: str):
    if robot_id not in robot_states:
        robot_states[robot_id] = {"status": "pending", "logs": []}
    robot_states[robot_id]["logs"].append(log_message)
    
    if robot_id in robot_active_connections:
        for ws in robot_active_connections[robot_id]:
            try:
                await ws.send_json({
                    "type": "log",
                    "message": log_message
                })
            except Exception:
                pass

async def broadcast_robot_status(robot_id: str, status: str):
    if robot_id not in robot_states:
        robot_states[robot_id] = {"status": "pending", "logs": []}
    robot_states[robot_id]["status"] = status
    
    if robot_id in robot_active_connections:
        for ws in robot_active_connections[robot_id]:
            try:
                await ws.send_json({
                    "type": "status",
                    "status": status
                })
            except Exception:
                pass

def run_robot_background(robot_id: str, script_code: str):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def log_cb(msg):
        asyncio.run_coroutine_threadsafe(broadcast_robot_log(robot_id, msg), loop)
        
    def status_cb(stat):
        asyncio.run_coroutine_threadsafe(broadcast_robot_status(robot_id, stat), loop)
        
    try:
        loop.run_until_complete(execute_robot_script(robot_id, script_code, log_cb, status_cb))
    except Exception:
        pass
    finally:
        loop.close()

@app.post("/api/robots/{robot_id}/run")
async def run_robot(robot_id: str, background_tasks: BackgroundTasks):
    file_path = os.path.join(ROBOTS_DIR, f"{robot_id}.json")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Robot not found")
        
    with open(file_path, "r") as f:
        robot_config = json.load(f)
        
    robot_states[robot_id] = {
        "status": "pending",
        "logs": []
    }
    
    background_tasks.add_task(run_robot_background, robot_id, robot_config.get("script_code", ""))
    return {"status": "started"}

@app.get("/api/robots/{robot_id}/state")
async def get_robot_state(robot_id: str):
    state = robot_states.get(robot_id, {"status": "pending", "logs": []})
    return {
        "status": state.get("status", "pending"),
        "logs": state.get("logs", [])
    }

# Serve Frontend static files
FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
