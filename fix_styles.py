import os
import glob
import re

directory = 'artifacts/avarpus-official-site/src/pages'

replacements = [
    (r'bg-\[#F6F4FF\](?:/\d+)?', 'bg-background'),
    (r'bg-slate-\d+(?:/\d+)?', 'bg-card'),
    (r'text-slate-900', 'text-foreground'),
    (r'text-slate-800', 'text-foreground'),
    (r'text-slate-700', 'text-foreground'),
    (r'text-slate-600', 'text-muted-foreground'),
    (r'text-slate-500', 'text-muted-foreground'),
    (r'text-slate-400', 'text-muted-foreground'),
    (r'text-slate-300', 'text-muted-foreground'),
    (r'dark:bg-\[[^\]]+\]', 'dark:bg-card'),
    (r'dark:bg-slate-\d+(?:/\d+)?', 'dark:bg-card'),
    (r'dark:text-slate-\d+', ''),
    (r'dark:border-slate-\d+', 'dark:border-border'),
    (r'dark:border-white(?:/\d+)?', 'dark:border-border'),
    (r'border-blue-\d+(?:/\d+)?', 'border-border'),
    (r'bg-blue-50(?:/\d+)?', 'bg-accent'),
    (r'text-blue-\d+', 'text-primary'),
    (r'text-emerald-\d+', 'text-[#12B76A]'),
    (r'bg-emerald-\d+(?:/\d+)?', 'bg-[#ECFDF3]'),
    (r'text-rose-\d+', 'text-[#F04438]'),
    (r'bg-rose-\d+(?:/\d+)?', 'bg-[#FEF3F2]'),
    (r'text-cyan-\d+', 'text-primary'),
    (r'bg-cyan-\d+(?:/\d+)?', 'bg-accent'),
    (r'text-violet-\d+', 'text-primary'),
    (r'bg-violet-\d+(?:/\d+)?', 'bg-accent'),
    (r'text-purple-\d+', 'text-primary'),
    (r'bg-purple-\d+(?:/\d+)?', 'bg-accent'),
    (r'text-teal-\d+', 'text-[#12B76A]'),
    (r'bg-teal-\d+(?:/\d+)?', 'bg-[#ECFDF3]'),
    (r'text-sky-\d+', 'text-primary'),
    (r'bg-sky-\d+(?:/\d+)?', 'bg-accent'),
    (r'text-indigo-\d+', 'text-primary'),
    (r'shadow-xl', 'card-shadow'),
    (r'shadow-lg', 'card-shadow'),
    (r'shadow-2xl', 'card-shadow'),
    (r'drop-shadow-2xl', 'card-shadow'),
    (r'shadow-md', 'card-shadow'),
    (r'rounded-3xl', 'rounded-[16px]'),
    (r'rounded-\[2\.5rem\]', 'rounded-[16px]'),
    (r'rounded-\[1\.5rem\]', 'rounded-[16px]'),
    (r'rounded-2xl', 'rounded-[16px]'),
    (r'backdrop-blur-xl', ''),
    (r'backdrop-blur-md', ''),
    (r'backdrop-blur-sm', ''),
    (r'dark:text-white', ''),
]

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    for pattern, repl in replacements:
        content = re.sub(pattern, repl, content)
        
    # Clean up double spaces created by empty replacements
    content = re.sub(r' +', ' ', content)
    
    with open(filepath, 'w') as f:
        f.write(content)

for root, _, files in os.walk(directory):
    for file in files:
        if file.endswith('.tsx'):
            process_file(os.path.join(root, file))
            
print("Done")
