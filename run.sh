#!/bin/bash
# ScraperX runner script

# Activate virtual environment
source venv/bin/activate

# Start fastapi server with uvicorn
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
