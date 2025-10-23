FROM python:3.9-slim

WORKDIR /app

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set working directory to backend
WORKDIR /app/backend

# Fetch assets and start the application
CMD ["sh", "-c", "python fetch_assets.py && uvicorn main:app --host 0.0.0.0 --port $PORT"]
