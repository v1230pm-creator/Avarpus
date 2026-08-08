import sys

with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'r') as f:
    content = f.read()

target = """          onEndReached={() => {
             if (repairsData?.total && repairsData.repairs.length < repairsData.total && !repairsFetching) {
               setPage(p => p + 1);
             }
          }}"""
new = """          onEndReached={() => {
             if (repairsData?.total && accumulatedRepairs.length < repairsData.total && !repairsFetching) {
               setPage(p => p + 1);
             }
          }}"""

content = content.replace(target, new)
with open('artifacts/mobile/app/(tabs)/repairs/index.tsx', 'w') as f:
    f.write(content)
