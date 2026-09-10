import re

with open('artifacts/avarpus-official-site/src/pages/features.tsx', 'r') as f:
    content = f.read()

content = re.sub(r'bg-\w+-\d+/\d+', 'bg-accent', content)
content = re.sub(r'border-\w+-\d+/\d+', 'border-border', content)
content = re.sub(r'bg-card/\d+', 'bg-card', content)
content = re.sub(r'bg-background/\d+', 'bg-accent', content)
content = re.sub(r'dark:bg-\w+-\d+/\d+', 'dark:bg-accent', content)
content = re.sub(r'dark:border-\w+-\d+/\d+', 'dark:border-border', content)
content = re.sub(r'hover:bg-card/\d+', 'hover:bg-card', content)
content = re.sub(r'hover:!bg-blue-700', 'hover:bg-[#4D4ECF]', content)
content = re.sub(r'hover:!text-white', 'hover:text-white', content)
content = re.sub(r'bg-accent dark:bg-accent border-border dark:border-border', 'bg-accent border-border', content)
content = re.sub(r'bg-card/30', 'bg-card', content)
content = re.sub(r'group-hover:bg-accent group-hover:border-border', 'group-hover:bg-accent group-hover:border-border', content)

with open('artifacts/avarpus-official-site/src/pages/features.tsx', 'w') as f:
    f.write(content)
