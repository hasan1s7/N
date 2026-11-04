"""Build a self-contained, CSP-hashed index. No npm or network dependency.
Run: python tools/build_standalone.py
The three deployment files are index.html, nabu-sw.js, nabu-repair.html.
The original JS modules remain editable sources, not startup dependencies.
"""
from pathlib import Path
import base64, hashlib, re
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
BUILD='nabu-startup-20261104-r2'
def read(name): return (PUBLIC/name).read_text()
def signature(value): return "'sha256-"+base64.b64encode(hashlib.sha256(value.encode()).digest()).decode()+"'"
def module(source, prefix=''):
    names=re.findall(r'^export (?:async )?(?:function|const) (\w+)',source,flags=re.M)
    source=re.sub(r'^import .*;\n','',source,flags=re.M)
    source=re.sub(r'^export ','',source,flags=re.M)
    return '(()=>{\n'+prefix+source+'\nreturn {'+','.join(names)+'};\n})()'
core=module(read('nabu-core.js'))
store=module(read('nabu-store.js'), 'const {cardContent,newCard,identity,scheduleReview,uid,VERSION}=C;\n')
app=re.sub(r'^import .*;\n','',read('nabu-app.js'),flags=re.M)
runtime='(function(){\n"use strict";\nconst C='+core+';\nconst DB='+store+';\n'+app+'\n})();'
startup=(ROOT/'tools/startup.js').read_text()
css=read('nabu.css')+'\n.startup-help{max-width:560px;margin:24px auto;text-align:center;font-size:13px;line-height:1.7}.startup-help summary{cursor:pointer;color:var(--green);font-weight:600}.startup-help a{color:var(--green);font-weight:700}.fatal .button-row{margin:24px 0}.fatal .small-print{margin-top:18px}.fatal #startup-error{overflow-wrap:anywhere}\n'
def policy(scripts,style):
    return "default-src 'self'; script-src 'self' "+' '.join(signature(x) for x in scripts)+"; script-src-attr 'none'; style-src 'self' "+signature(style)+"; img-src 'self' data:; connect-src 'self' https://api.mymemory.translated.net; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; manifest-src 'self'"
html=(ROOT/'tools/index.template.html').read_text().replace('<html lang="en">',f'<html lang="en" data-nabu-build="{BUILD}">')
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>',lambda _: '<meta http-equiv="Content-Security-Policy" content="'+policy([startup,runtime],css)+'">',html)
# Embedded favicon and CSS: no asset fetch is required to render or start.
svg=read('nabu-icon.svg').encode()
html=html.replace('href="./nabu-icon.svg"', 'href="data:image/svg+xml;base64,'+base64.b64encode(svg).decode()+'"')
html=html.replace('  <link rel="manifest" href="./nabu.webmanifest">\n','')
html=html.replace('<link rel="stylesheet" href="./nabu.css">','<style>'+css+'</style>')
html=html.replace('  <script type="module" src="./nabu-app.js"></script>\n','')
html=html.replace('<p>Opening your private library...</p>', '<p id="startup-status" role="status" aria-live="polite">Opening your private library...</p><details class="startup-help"><summary>Taking too long?</summary><p><a href="./nabu-repair.html">Repair app loading</a> without deleting your words. Do not clear browser site data.</p></details>')
assert '</script' not in runtime.lower() and '</script' not in startup.lower()
html=html.replace('</body>', '<script id="nabu-startup-guard">'+startup+'</script>\n<script id="nabu-application">'+runtime+'</script>\n</body>')
(PUBLIC/'index.html').write_text(html)
repair=(ROOT/'tools/repair.js').read_text()
repair_css="body{margin:0;background:#f6f8f3;color:#20322b;font:16px/1.65 system-ui,sans-serif}main{max-width:640px;margin:10vh auto;padding:32px}h1{font-size:34px;line-height:1.2;letter-spacing:-1px}a{color:#24624f;font-weight:650}p{overflow-wrap:anywhere}.eyebrow{font-size:12px;letter-spacing:3px;color:#24624f}.notice{border:1px solid #c8d8cc;border-radius:12px;padding:18px;background:white}"
repair_html='''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="__CSP__"><title>Repair Nabu loading</title><style>__CSS__</style></head><body><main><p class="eyebrow">NABU / SAFE STARTUP REPAIR</p><h1>Refresh the app.<br>Keep your words.</h1><p id="repair-status" role="status" aria-live="polite">Refreshing this Nabu site's app files...</p><p class="notice">This repair removes outdated app-file caches and the offline worker for this Nabu path. It does not reset your word database, review history, settings, or account.</p><p><a href="./nabu-repair.html">Retry repair</a> &nbsp; <a href="./">Open Nabu</a></p><noscript><p>Enable JavaScript to run the repair. Do not use Clear site data; that can erase your library.</p></noscript></main><script>__SCRIPT__</script></body></html>'''
repair_html=repair_html.replace('__CSP__',policy([repair],repair_css)).replace('__CSS__',repair_css).replace('__SCRIPT__',repair)
(PUBLIC/'nabu-repair.html').write_text(repair_html)
print('Built',len(html.encode()),'bytes; app scripts/styles use exact SHA-256 CSP hashes.')
