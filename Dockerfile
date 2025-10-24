FROM python:3.9-slim

WORKDIR /app/backend

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Start the application directly
CMD ["python", "-c", "import subprocess; subprocess.run(['python', 'fetch_assets.py']); subprocess.run(['uvicorn', 'main:app', '--host', '0.0.0.0', '--port', '8000'])"]
