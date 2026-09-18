export type AccountSection = "profile" | "security" | "permissions";

export interface CurrentAccount {
  authUserId: string;
  email: string | null;
  profileId: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: string | null;
  active: boolean | null;
  permissions: string[];
  permissionMatrix: RolePermissionRow[];
}

export interface RolePermissionRow {
  roleCode: string;
  roleLabel: string;
  permission: string | null;
}

export interface UpdateProfileInput {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}
