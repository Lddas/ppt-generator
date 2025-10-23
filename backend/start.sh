#!/bin/bash
# Copy template files to current directory
cp ../dist/*.pptx . 2>/dev/null || true
cp ../dist/*.json . 2>/dev/null || true
cp ../dist/*.jpg . 2>/dev/null || true

# Start the server
uvicorn main:app --host 0.0.0.0 --port $PORT
