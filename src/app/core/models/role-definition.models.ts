/**
 * Distinguishes a claimable meeting role (Evening Chairman, Grammarian, ...
 * — claimed live via check-in) from a committee/governance title (President,
 * Secretary, ... — assigned only by an admin on /admin/committee-roles).
 * Both kinds share one Firestore collection (`roleDefinitions`) and one
 * service (`RoleDefinitionService`) — see that file's class doc for why.
 */
export type RoleKind = 'meeting' | 'committee';

export interface RoleDefinition {
  id: string;
  label: string;
  description?: string;
  order: number;
  active: boolean;
  kind: RoleKind;
}
