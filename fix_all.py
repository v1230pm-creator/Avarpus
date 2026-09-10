import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Common overrides on cards and buttons
    content = re.sub(r'bg-card/50', 'bg-card card-shadow', content)
    content = re.sub(r'bg-card/30', 'bg-card card-shadow', content)
    content = re.sub(r'border-sky-\d+/\d+', 'border-border', content)
    content = re.sub(r'dark:border-sky-\d+/\d+', 'dark:border-border', content)
    content = re.sub(r'border-cyan-\d+/\d+', 'border-border', content)
    content = re.sub(r'dark:border-cyan-\d+/\d+', 'dark:border-border', content)
    content = re.sub(r'border-teal-\d+/\d+', 'border-border', content)
    content = re.sub(r'dark:border-teal-\d+/\d+', 'dark:border-border', content)
    content = re.sub(r'border-indigo-\d+/\d+', 'border-border', content)
    content = re.sub(r'dark:border-indigo-\d+/\d+', 'dark:border-border', content)
    content = re.sub(r'hover:!bg-blue-\d+', '', content)
    content = re.sub(r'hover:!text-white', '', content)
    content = re.sub(r'rounded-full', 'rounded-[12px]', content)  # Let buttons standard rounding take over if Button, but rounded-[12px] works for cards too
    
    # We want to be careful with rounded-full on icons, so let's only replace it on buttons
    # Actually it's easier to let CSS `Button` component override classes, or just remove `rounded-full` from `<Button className="... rounded-full ...">`
    content = re.sub(r'<Button([^>]*)rounded-full', r'<Button\1', content)
    content = re.sub(r'<Button([^>]*)rounded-\[16px\]', r'<Button\1', content)
    content = re.sub(r'Button([^>]*)h-14', r'Button\1size="lg"', content)
    content = re.sub(r'Button([^>]*)h-12', r'Button\1size="lg"', content)

    # Some classes from Shell.tsx / other
    content = re.sub(r'text-blue-\d+', 'text-primary', content)
    
    # Double spaces
    content = re.sub(r' +', ' ', content)

    with open(filepath, 'w') as f:
        f.write(content)

for root, _, files in os.walk('artifacts/avarpus-official-site/src/pages'):
    for file in files:
        if file.endswith('.tsx'):
            process_file(os.path.join(root, file))
            
print("Done all")
