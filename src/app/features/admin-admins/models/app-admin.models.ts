/** One entry in the appAdmins/{uid} collection — see AppAdminService. */
export interface AppAdmin {
  uid: string;
  email: string;
  displayName: string;
  grantedAt: string;
  grantedByEmail: string;
}
