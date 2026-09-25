"""Build a loadable ZIP containing only extension runtime files (no dependencies)."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
destination = root / 'dist' / f"github-media-gallery-{manifest['version']}.zip"
latest = root / 'dist' / 'github-media-gallery-latest.zip'
destination.parent.mkdir(exist_ok=True)
files = ['manifest.json', 'background.js', 'media-model.js', 'content.js', 'content.css', 'gallery.css', 'README.md']
files += [str(path.relative_to(root)) for path in (root / 'icons').glob('*.png')]
files += [str(path.relative_to(root)) for path in (root / 'artifacts').glob('*.png')]
def write_archive(path):
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        for name in files:
            archive.write(root / name, name)

write_archive(destination)
write_archive(latest)
print(destination)
print(latest)
