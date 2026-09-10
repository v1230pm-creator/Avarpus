import os
import re

def fix(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # size="lg" inside className
    content = re.sub(r'className="([^"]*)size="lg"([^"]*)"', r'size="lg" className="\1\2"', content)
    content = re.sub(r'className="([^"]*)size="lg"([^"]*)"', r'size="lg" className="\1\2"', content) # Run twice in case of multiple quotes?
    # actually it's easier to just find `size="lg"` inside the classname string which breaks the string
    # like `className="something size="lg" something"`
    content = re.sub(r'className="([^"]*)size="lg"([^"]*)"', r'size="lg" className="\1 \2"', content)
    
    # Just generic fix for Button with size="lg" inside classname
    # Since the string is broken, it looks like: className="something size="lg" something"
    # Actually wait: `className="something size="lg" something"` -> The first quote ends at `className="something size="`.
    
    with open(filepath, 'w') as f:
        f.write(content)

for root, _, files in os.walk('artifacts/avarpus-official-site/src/pages'):
    for file in files:
        if file.endswith('.tsx'):
            fix(os.path.join(root, file))
