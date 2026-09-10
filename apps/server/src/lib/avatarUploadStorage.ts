import { getBucket } from "../runtime.js";
import { avatarKey } from "./avatarStore.js";

export const avatarUploadPrefix = (userId: string) => `avatars/${userId}/uploads/`;
/** Also includes leftovers from interrupted uploads. Called after account deletion,
 * or after soft deletion has already disabled avatar writes. */
export async function uploadedAvatarKeys(userId: string, onList = () => {}): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    onList();
    const page = await getBucket().list({ prefix: avatarUploadPrefix(userId), cursor });
    keys.push(...page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function deleteUserAvatarObjects(userId: string): Promise<void> {
  const keys = [avatarKey(userId), ...await uploadedAvatarKeys(userId)];
  for (let i = 0; i < keys.length; i += 1000) await getBucket().delete(keys.slice(i, i + 1000));
}
