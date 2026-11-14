import os
import sys
import json
import urllib.request
import shutil
import zipfile

ASSETS_FILE = os.path.join(os.path.dirname(__file__), 'assets_manifest.json')


def unpack_bundle(zip_path):
    """Unpack the templates bundle here. A Dropbox *folder* link (dl=1) downloads a zip of the
    folder, which may or may not have the folder itself as its top level: find slices/ either way."""
    tmp = 'bundle_tmp'
    with zipfile.ZipFile(zip_path) as bundle:
        bundle.extractall(tmp)
    os.remove(zip_path)
    root = next((r for r, dirs, _ in os.walk(tmp) if 'slices' in dirs), None)
    if root is None:
        shutil.rmtree(tmp)
        raise RuntimeError('no slices/ folder found in the bundle')
    for name in os.listdir(root):
        if os.path.exists(name):
            shutil.rmtree(name) if os.path.isdir(name) else os.remove(name)
        shutil.move(os.path.join(root, name), name)
    shutil.rmtree(tmp)


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
        # a .zip is a bundle (see make_bundle.py): unpacked here, so it is "there" once slices/ is
        if os.path.exists(filename) or (filename.endswith('.zip') and os.path.isdir('slices')):
            print(f'{filename} already exists, skipping.')
            continue

        if 'REPLACE_WITH_PRESIGNED_URL' in url:
            print(f'{filename}: no download URL yet (placeholder in assets_manifest.json)')
            missing.append(filename)
            continue

        print(f'Downloading {filename}...')
        try:
            urllib.request.urlretrieve(url, filename)
            if filename.endswith('.zip'):
                unpack_bundle(filename)
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
