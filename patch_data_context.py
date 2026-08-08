import sys

with open('artifacts/mobile/context/DataContext.tsx', 'r') as f:
    content = f.read()

target_add = """      problem: r.problem,
      technicianId: r.technicianId,
      technicianName: r.technicianName,
      status: r.status,"""
new_add = """      problem: r.problem,
      status: r.status,"""
content = content.replace(target_add, new_add)

target_update = """      workPerformed: r.workPerformed,
      technicianId: r.technicianId,
      technicianName: r.technicianName,
      status: r.status,"""
new_update = """      workPerformed: r.workPerformed,
      status: r.status,"""
content = content.replace(target_update, new_update)

with open('artifacts/mobile/context/DataContext.tsx', 'w') as f:
    f.write(content)
