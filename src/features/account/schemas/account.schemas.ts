import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2, "Ingresa al menos 2 caracteres.").max(80, "El nombre es demasiado largo."),
  lastName: z.string().trim().min(2, "Ingresa al menos 2 caracteres.").max(120, "Los apellidos son demasiado largos."),
  phone: z.string().trim().max(30, "El teléfono no puede superar 30 caracteres."),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Ingresa tu contraseña actual."),
  newPassword: z.string()
    .min(8, "La nueva contraseña debe tener al menos 8 caracteres.")
    .regex(/[A-Za-z]/, "La contraseña debe incluir al menos una letra.")
    .regex(/[0-9]/, "La contraseña debe incluir al menos un número."),
  confirmation: z.string().min(1, "Confirma la nueva contraseña."),
}).refine((value) => value.newPassword === value.confirmation, {
  path: ["confirmation"],
  message: "Las contraseñas no coinciden.",
}).refine((value) => value.currentPassword !== value.newPassword, {
  path: ["newPassword"],
  message: "La nueva contraseña debe ser diferente de la actual.",
});

export function firstZodError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Revisa los datos ingresados.";
}
