import pathlib
p = pathlib.Path('js/views.js')
s = p.read_text()
old = "String())` : ''</span></span></div>"
new = "String())` : ''}</span></span></div>"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, new)
p.write_text(s)
print('fixed, count=1')
