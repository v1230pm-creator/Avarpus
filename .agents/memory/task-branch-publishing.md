---
name: Task-branch publishing isolation
description: Release-gate planning when validation depends on code still isolated in an assigned task branch.
---

Publishing from the parent workspace does not include code that exists only in an assigned task's isolated branch, even when the user publishes the correct artifact.

**Why:** A production API restart successfully deployed the parent revision but did not contain a protected diagnostic route that existed and passed locally in the assigned task branch.

**How to apply:** If a release gate needs production validation of new task code, split deployment preparation into a predecessor task that can merge first. For physical checks before merge, use the task's development workflow and separately inspect production logs as required.