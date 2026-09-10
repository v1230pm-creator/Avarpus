export type PortalContract = {
  families: Array<Record<string, unknown> & { id: string; label: string }>;
  rules: Array<{ family: string; method: string; pattern: string }>;
};

export type PortalContractProfile = {
  portal: string;
  coverageModes: Array<{
    present(family: Record<string, unknown>): boolean;
    validate(family: Record<string, unknown>, portal: string): void;
  }>;
};

export function validatePortalContract(
  contract: PortalContract,
  profile: PortalContractProfile,
): PortalContract["families"];

export const customerPortalProfile: PortalContractProfile;
export const dealerPortalProfile: PortalContractProfile;