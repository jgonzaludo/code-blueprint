import json,sys
F='../feat/'
css=open(F+'pm.css').read(); js=open(F+'pm.js').read(); term=open('term.css').read()
data=open(F+'data.json').read()
head=open('head.html').read()
for n in 'abcd':
    s=open(n+'.html').read()
    s=s.replace('/*PM_CSS*/',css).replace('/*TERM_CSS*/',term).replace('/*PM_JS*/',js)
    s=s.replace('__DATA__',data.replace('</','<\\/'))
    # pm.js declares its own data const; mocks a,b read it themselves
    if n in 'ab': pass
    open('out_'+n+'.html','w').write(head+s)
print('built')
