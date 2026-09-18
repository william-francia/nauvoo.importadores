import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changeMyPassword, closeOtherSessions, fetchCurrentAccount, updateMyProfile } from "../services/account.service";
import type { ChangePasswordInput, UpdateProfileInput } from "../types/account.types";

export const currentAccountQueryKey = ["current-account"] as const;

export function useCurrentAccount() {
  return useQuery({ queryKey: currentAccountQueryKey, queryFn: fetchCurrentAccount });
}

export function usePermissions() {
  const account = useCurrentAccount();
  const permissionSet = new Set(account.data?.permissions ?? []);
  return {
    ...account,
    can: (permission: string) => permissionSet.has(permission),
    canAny: (...permissions: string[]) => permissions.some((permission) => permissionSet.has(permission)),
  };
}

export function useUpdateMyProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => updateMyProfile(input),
    onSuccess: () => client.invalidateQueries({ queryKey: currentAccountQueryKey }),
  });
}

export function useChangeMyPassword(email: string | null) {
  return useMutation({ mutationFn: (input: ChangePasswordInput) => changeMyPassword(email, input) });
}

export function useCloseOtherSessions() {
  return useMutation({ mutationFn: closeOtherSessions });
}
