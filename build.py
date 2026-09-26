"""Builds the single-file site: inlines the 3D world, the UI script, icons, textures and figures into index.html."""
import base64, json, os, re
R = os.path.dirname(os.path.abspath(__file__))
src = lambda *p: os.path.join(R, *p)
page = open(src('src', 'page.html')).read()
world = open(src('src', 'world.js')).read()
ui = open(src('src', 'ui.js')).read()
data = {}
for f in sorted(os.listdir(src('assets', 'img'))):
    if f.endswith('.webp'):
        data[f[:-5]] = 'data:image/webp;base64,' + base64.b64encode(open(src('assets', 'img', f), 'rb').read()).decode()
for k in ('man', 'lady', 'boatman'):
    f = src('assets', 'models', k + '-s.glb')
    if os.path.exists(f):
        data['glb-' + k] = 'data:model/gltf-binary;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
syms = []
for f in sorted(os.listdir(src('assets', 'icons'))):
    if f.endswith('.svg'):
        body = re.sub(r'^<svg[^>]*>|</svg>\s*$', '', open(src('assets', 'icons', f)).read().strip())
        syms.append('<symbol id="p-%s" viewBox="0 0 256 256">%s</symbol>' % (f[:-4], body))
page = page.replace('<!--ICONS-->', ''.join(syms))
assert '/*WORLD*/' in page and '/*UI*/' in page and '/*IMG*/' in page
out = page.replace('/*WORLD*/', world).replace('/*UI*/', ui).replace('/*IMG*/', json.dumps(data))
open(src('index.html'), 'w').write(out)
print('built index.html', round(len(out) / 1e6, 2), 'MB')
