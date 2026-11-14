import os
import sys
import json
import urllib.request

ASSETS_FILE = os.path.join(os.path.dirname(__file__), 'assets_manifest.json')


def ensure_assets(strict=False):
    """Download the template decks listed in assets_manifest.json (the ones not already here).
    With strict=True (Docker build) exit with an error if one cannot be obtained."""
    if not os.path.exists(ASSETS_FILE):
        print('No assets_manifest.json found. Skipping fetch.')
        return

    with open(ASSETS_FILE, 'r', encoding='utf-8') as fh:
        manifest = json.load(fh)

    missing = []
    for filename, url in manifest.items():
        if os.path.exists(filename):
            print(f'{filename} already exists, skipping.')
            continue

        if 'REPLACE_WITH_PRESIGNED_URL' in url:
            print(f'{filename}: no download URL yet (placeholder in assets_manifest.json)')
            missing.append(filename)
            continue

        print(f'Downloading {filename}...')
        try:
            urllib.request.urlretrieve(url, filename)
            print(f'OK: {filename}')
        except Exception as e:
            print(f'Failed to download {filename}: {e}')
            if os.path.exists(filename):
                os.remove(filename)  # never leave a partial/empty template behind
            missing.append(filename)

    if missing:
        print('Missing template files:', ', '.join(missing))
        if strict:
            sys.exit(1)


if __name__ == '__main__':
    ensure_assets(strict=bool(os.environ.get('STRICT_ASSETS')))
