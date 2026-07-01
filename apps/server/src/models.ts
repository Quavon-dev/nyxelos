import { getDb } from "@nyxel/db";
import { type InstalledModelProvider, toInstalledModelProvider } from "@nyxel/model-providers";

export async function getInstalledProvidersForWorkspace(
  workspaceId: string,
): Promise<InstalledModelProvider[]> {
  const installations = await getDb().listModelInstallationsByWorkspace(workspaceId);
  return installations.map((installation) => toInstalledModelProvider(installation));
}
