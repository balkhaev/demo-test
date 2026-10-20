from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent
files = [
    'dist/index.html', 'dist/styles.css', 'dist/app.js', 'dist/engine.js',
    'dist/data.js', 'dist/prompt.txt', 'test/engine.test.mjs',
    'README.md', 'package.json', 'Dockerfile', 'build-demo.mjs', 'package-demo.py',
]
with ZipFile(root / 'dist/project.zip', 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
with ZipFile(root / 'dist/project.zip', 'r') as archive:
    assert archive.testzip() is None
print(f'Packaged {len(files)} project files with relative paths preserved.')
