"""Build Lambda deployment zip with Windows long path support."""
import zipfile
import os

zippath = 'lambda-deploy-new.zip'
PREFIX = '\\\\?\\'

def longpath(p):
    abs_p = os.path.abspath(p)
    if not abs_p.startswith(PREFIX):
        abs_p = PREFIX + abs_p
    return abs_p

with zipfile.ZipFile(zippath, 'w', zipfile.ZIP_DEFLATED) as zf:
    # Add root index.mjs
    zf.write('index.mjs', 'index.mjs')
    print('Added: index.mjs')

    # Add aws-costs/index.mjs
    zf.write('aws-costs/index.mjs', 'aws-costs/index.mjs')
    print('Added: aws-costs/index.mjs')

    # Add costs/ directory
    for f in os.listdir('costs'):
        if f.endswith('.mjs'):
            zf.write(f'costs/{f}', f'costs/{f}')
            print(f'Added: costs/{f}')

    # Add node_modules with long path support
    count = 0
    skipped = 0
    for root, dirs, files in os.walk('node_modules'):
        for file in files:
            filepath = os.path.join(root, file)
            arcname = filepath.replace(os.sep, '/')
            try:
                lp = longpath(filepath)
                with open(lp, 'rb') as fh:
                    data = fh.read()
                zf.writestr(arcname, data)
                count += 1
            except Exception as e:
                skipped += 1
    print(f'Added: {count} node_modules files (skipped {skipped})')

size = os.path.getsize(zippath)
print(f'\nZip created: {zippath} ({size / 1024 / 1024:.1f} MB)')
