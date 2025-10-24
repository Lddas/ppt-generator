import os
import json
import urllib.request

ASSETS_FILE = os.path.join(os.path.dirname(__file__), 'assets_manifest.json')

def ensure_assets():
    if not os.path.exists(ASSETS_FILE):
        print('No assets_manifest.json found. Skipping fetch.')
        return
    
    with open(ASSETS_FILE, 'r', encoding='utf-8') as fh:
        manifest = json.load(fh)
    
    for filename, url in manifest.items():
        if os.path.exists(filename):
            print(f'{filename} already exists, skipping.')
            continue
            
        # Skip if URL is a placeholder
        if 'REPLACE_WITH_PRESIGNED_URL' in url:
            print(f'Skipping {filename} - URL is placeholder: {url}')
            continue
            
        print(f'Downloading {filename}...')
        try:
            urllib.request.urlretrieve(url, filename)
            print(f'OK: {filename}')
        except Exception as e:
            print(f'Failed to download {filename}: {e}')
            # Create empty file as fallback
            print(f'Creating empty {filename} as fallback...')
            with open(filename, 'w') as f:
                f.write('{}' if filename.endswith('.json') else '')

if __name__ == '__main__':
    ensure_assets()

