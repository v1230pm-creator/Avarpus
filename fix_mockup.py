import re

with open('artifacts/avarpus-official-site/src/components/ui/mockup.tsx', 'r') as f:
    content = f.read()

content = re.sub(r'bg-slate-100 dark:bg-slate-800', 'bg-accent border border-border', content)
content = re.sub(r'bg-slate-100', 'bg-accent', content)
content = re.sub(r'dark:bg-slate-900', 'dark:bg-card', content)
content = re.sub(r'border-slate-400 dark:border-slate-800', 'border-border', content)
content = re.sub(r'bg-slate-400 dark:bg-slate-800', 'bg-border', content)
content = re.sub(r'shadow-2xl', 'card-shadow', content)
content = re.sub(r'shadow-xl', 'card-shadow', content)

# Some text slate stuff
content = re.sub(r'text-slate-\d+', 'text-foreground', content)
content = re.sub(r'dark:text-slate-\d+', '', content)

with open('artifacts/avarpus-official-site/src/components/ui/mockup.tsx', 'w') as f:
    f.write(content)
