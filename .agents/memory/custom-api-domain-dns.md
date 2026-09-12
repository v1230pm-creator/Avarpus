---
name: Custom API domain DNS
description: Why the released mobile app can fail every request while the API deployment is perfectly healthy, and how to tell the two apart.
---

The published API is reached through a custom domain owned in the registrar's DNS
zone (the marketing site's zone), not through the generated deployment hostname.
The mobile release build bakes that hostname in at build time, so if the `api`
subdomain record disappears from the zone, **every** installed app fails at the
network layer while the deployment itself stays healthy and reachable at its
generated hostname.

**Why:** a released APK cannot be re-pointed without a new build, so DNS is the only
lever that repairs existing installs. Misreading this as a server-side or provider-side
outage wastes a whole debugging pass — provider credentials, rate limits, and route
code all look suspicious and are all innocent.

**How to apply:** when users report a released-app failure that presents as a generic
client fallback message ("could not ... please try again"):

1. Check the deployment's own generated hostname first — if it answers, the server is fine.
2. Resolve the custom API hostname from an outside resolver. `NXDOMAIN` there is the
   answer; do not dismiss it as a workspace network restriction. Other public hostnames
   resolve fine from the workspace, so a single failing name is a real missing record.
3. Confirm with the production logs: if the user retries *while you watch* and no new
   request line appears at all, the traffic never left their phone's DNS lookup.
   A request that reached the server always logs, even when it fails.
4. The deployment-readiness validation step that warns about an unresolvable production
   API origin is a genuine signal for exactly this failure, not sandbox noise.

Generic client fallback copy hides this class of failure. Distinguishing "server said no"
from "could not reach server" in user-facing error text turns a multi-hour hunt into a
one-glance diagnosis.
