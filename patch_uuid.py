import sys

with open('artifacts/mobile/utils/helpers.ts', 'r') as f:
    content = f.read()

new_content = content + """
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
"""

with open('artifacts/mobile/utils/helpers.ts', 'w') as f:
    f.write(new_content)
