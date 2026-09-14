const HTTP_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);

function fail(portal, message) {
  throw new Error(`${portal} portal contract: ${message}`);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validatePortalContract(contract, profile) {
  if (!Array.isArray(contract?.families) || !Array.isArray(contract?.rules)) {
    fail(profile.portal, "families and rules must be arrays");
  }

  const familiesById = new Map();
  for (const family of contract.families) {
    if (!nonEmptyString(family?.id) || !nonEmptyString(family?.label)) {
      fail(profile.portal, "every family needs a non-empty id and label");
    }
    if (familiesById.has(family.id)) {
      fail(profile.portal, `duplicate family: ${family.id}`);
    }
    familiesById.set(family.id, family);
  }

  const ruleFamilies = new Set();
  for (const rule of contract.rules) {
    if (!familiesById.has(rule?.family)) {
      fail(profile.portal, `rule references unknown family: ${String(rule?.family)}`);
    }
    ruleFamilies.add(rule.family);
  }

  for (const family of contract.families) {
    if (!ruleFamilies.has(family.id)) {
      fail(profile.portal, `family has no allowlist rules: ${family.id}`);
    }

    const modes = profile.coverageModes.filter((mode) => mode.present(family));
    if (modes.length !== 1) {
      fail(profile.portal, `family needs exactly one coverage mode: ${family.id}`);
    }
    modes[0].validate(family, profile.portal);
  }

  return contract.families;
}

export const customerPortalProfile = {
  portal: "Customer",
  coverageModes: [
    {
      present: (family) => nonEmptyString(family.isolationProbe),
      validate: (family, portal) => {
        const supported = new Set([
          "repair-ownership",
          "customer-balance-ownership",
          "notification-recipient",
          "status-audience",
          "chat-membership",
          "chat-report-author",
        ]);
        if (!supported.has(family.isolationProbe)) {
          fail(portal, `unsupported probe for family ${family.id}: ${family.isolationProbe}`);
        }
      },
    },
    {
      present: (family) => nonEmptyString(family.isolationExempt),
      validate: (family, portal) => {
        if (family.isolationExempt.trim().length <= 20) {
          fail(portal, `exemption is not documented for family: ${family.id}`);
        }
      },
    },
  ],
};

const INACTIVE_DEALER_EXEMPT_FAMILIES = new Set(["auth-self-service", "shop-setup"]);

export const dealerPortalProfile = {
  portal: "Dealer",
  coverageModes: [
    {
      present: (family) => family.inactiveProbe != null,
      validate: (family, portal) => {
        const probe = family.inactiveProbe;
        if (
          !probe
          || !HTTP_METHODS.has(probe.method)
          || !nonEmptyString(probe.path)
          || !probe.path.startsWith("/")
          || (probe.body !== undefined && (typeof probe.body !== "object" || probe.body === null || Array.isArray(probe.body)))
        ) {
          fail(portal, `unsupported probe for family: ${family.id}`);
        }
      },
    },
    {
      present: (family) => family.inactiveDealerExempt === true,
      validate: (family, portal) => {
        // Only the caller's OWN account and their OWN (future) Shop may stay
        // reachable while the supplier has switched the portal off: neither
        // exposes a byte of the supplier's data.
        if (!INACTIVE_DEALER_EXEMPT_FAMILIES.has(family.id)) {
          fail(portal, `unsupported exemption for family: ${family.id}`);
        }
      },
    },
  ],
};