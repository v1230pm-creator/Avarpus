---
name: Customer portal allowlist contract
description: Why a correct new API endpoint still 403s for customer-role accounts, and what has to be declared before it works.
---

## A new endpoint is invisible to customer accounts until the contract names it

`role = "customer"` accounts are gated at the auth boundary by an explicit
allowlist contract, not by the endpoint's own authorization. A route that
authorizes perfectly well still answers 403 `CUSTOMER_PORTAL_FORBIDDEN` for
those accounts until a matching method/path rule is added to the contract, and
every rule belongs to a family that must declare exactly one coverage mode:
either a named isolation probe or a written exemption.

**Why:** fail-closed by default is the point — future business endpoints must
not become reachable by end-user accounts just because somebody added a router
line. The family/coverage requirement is what stops the allowlist from growing
into an undocumented list of holes.

**How to apply:** when adding an end-user-facing endpoint, add the rule, pick or
create a family, and register any new probe name with the contract validator —
then actually implement that probe as a cross-account check in the portal
isolation script, not just as a string in the JSON. The symptom of forgetting
all this is a passing unit test and an integration test where only the
customer-role callers get 403.
