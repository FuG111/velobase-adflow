// Composition boundary: product modules consume public capabilities through this contract.
export {
  requireEntitlement,
  entitlement,
  plans,
} from "@/modules/ad-entitlements/server/service";
