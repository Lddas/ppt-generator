#!/usr/bin/env python3

import os
import sys

# Install requirements
os.system("pip install -r requirements.txt")

# Copy dist files to backend directory for deployment
import shutil
import glob

# Copy all PPTX files and index.json from dist to backend
dist_dir = os.path.join(os.path.dirname(__file__), '..', 'dist')
backend_dir = os.path.dirname(__file__)

for file_pattern in ['*.pptx', '*.json', '*.jpg']:
    for file_path in glob.glob(os.path.join(dist_dir, file_pattern)):
        filename = os.path.basename(file_path)
        shutil.copy2(file_path, os.path.join(backend_dir, filename))
        print(f"Copied {filename} to backend directory")

print("Setup complete!")
