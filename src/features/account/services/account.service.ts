import { supabase } from "../../../lib/supabase";
import { changePasswordSchema, firstZodError, updateProfileSchema } from "../schemas/account.schemas";
import type { ChangePasswordInput, CurrentAccount, RolePermissionRow, UpdateProfileInput } from "../types/account.types";

interface ProfileRow {
  id: string;
  nombre: string;
  apellidos: string;
  telefono: string | null;
  rol: string;
  activo: boolean;
}

interface PermissionRow {
  permission: string;
}

interface MatrixRow {
  role_code: string;
  role_label: string;
  permission: string | null;
}

export async function fetchCurrentAccount(): Promise<CurrentAccount> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw new Error(authError.message || "No se pudo validar la sesión.");
  if (!authData.user) throw new Error("No existe una sesión activa.");

  const [profileResult, permissionsResult, matrixResult] = await Promise.all([
    supabase.from("usuarios").select("id, nombre, apellidos, telefono, rol, activo").eq("auth_user_id", authData.user.id).maybeSingle(),
    supabase.rpc("mis_permisos"),
    supabase.rpc("matriz_permisos"),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message || "No se pudo cargar el perfil.");
  if (permissionsResult.error) throw new Error(permissionsResult.error.message || "No se pudieron cargar los permisos.");
  if (matrixResult.error) throw new Error(matrixResult.error.message || "No se pudo cargar la matriz de permisos.");

  const profile = profileResult.data as ProfileRow | null;
  const matrix = (matrixResult.data ?? []) as MatrixRow[];
  return {
    authUserId: authData.user.id,
    email: authData.user.email ?? null,
    profileId: profile?.id ?? null,
    firstName: profile?.nombre ?? null,
    lastName: profile?.apellidos ?? null,
    phone: profile?.telefono ?? null,
    role: profile?.rol ?? null,
    active: profile?.activo ?? null,
    permissions: ((permissionsResult.data ?? []) as PermissionRow[]).map((row) => row.permission),
    permissionMatrix: matrix.map((row): RolePermissionRow => ({
      roleCode: row.role_code,
      roleLabel: row.role_label,
      permission: row.permission,
    })),
  };
}

export async function updateMyProfile(input: UpdateProfileInput): Promise<void> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) throw new Error(firstZodError(parsed.error));
  const { error } = await supabase.rpc("actualizar_mi_perfil", {
    p_nombre: parsed.data.firstName,
    p_apellidos: parsed.data.lastName,
    p_telefono: parsed.data.phone || null,
  });
  if (error) throw new Error(error.message || "No se pudo actualizar el perfil.");
}

export async function changeMyPassword(email: string | null, input: ChangePasswordInput): Promise<void> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) throw new Error(firstZodError(parsed.error));
  if (!email) throw new Error("La sesión actual no tiene un correo verificable.");

  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: parsed.data.currentPassword });
  if (verifyError) throw new Error("La contraseña actual no es correcta.");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) throw new Error(error.message || "No se pudo actualizar la contraseña.");
}

export async function closeOtherSessions(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) throw new Error(error.message || "No se pudieron cerrar las otras sesiones.");
}

export async function signOutCurrentSession(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error(error.message || "No se pudo cerrar la sesión.");
}
