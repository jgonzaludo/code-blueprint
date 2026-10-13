import re
css=open('core.css').read(); js=open('core.js').read()
for n in 'abcd':
    s=open(n+'.html').read()
    s=s.replace('/*CORE_CSS*/',css,1).replace('//CORE_JS',js,1)
    open('out_'+n+'.html','w').write(s)
