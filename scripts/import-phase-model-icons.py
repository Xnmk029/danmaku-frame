"""Import the supplied PHASE/MARK signal SVGs, catalog and MIT attribution."""
import argparse
import json
from pathlib import Path
import re
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'public/frame/assets/model-marks'
root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.archive) as archive:
    manifest = json.loads(archive.read('manifest.json'))
    icons = []
    for entry in manifest['icons']:
        icon_id = entry['id']
        if not re.fullmatch(r'[a-z0-9-]+', icon_id):
            raise ValueError('Invalid icon id')
        source = f'exports/scaled/240/signal/{icon_id}.svg'
        data = archive.read(source)
        # Standalone vector assets; never import executable content or remote resources.
        if re.search(rb'<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["\'](?:https?:|//|javascript:)', data, re.I):
            raise ValueError(f'Non-local SVG content: {icon_id}')
        (root / f'{icon_id}.svg').write_bytes(data)
        icons.append({'id': icon_id, 'name': entry['name'], 'featured': entry.get('featured', False)})
    (root / 'UPSTREAM-LICENSE').write_bytes(archive.read('UPSTREAM-LICENSE'))
    (root / 'REFERENCE.md').write_bytes(archive.read('README.md'))
    metadata = {'source': 'phase-mark-complete.zip', 'upstream': manifest['upstream'], 'commit': manifest['commit'],
                'variant': 'exports/scaled/240/signal', 'icons': icons}
    (root / 'catalog.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    (root / 'catalog.js').write_text('window.PhaseModelIcons=' + json.dumps(icons, ensure_ascii=False) + ';\n', encoding='utf-8')
print(f'Imported {len(icons)} PHASE/MARK icons into {root}')
