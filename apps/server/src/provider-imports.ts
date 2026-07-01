import { getDb } from "@nyxel/db";
import { type ProviderImportSource, scanProviderImportSources } from "@nyxel/model-providers";

export async function listProviderImportSources(): Promise<ProviderImportSource[]> {
  return scanProviderImportSources();
}

export async function importProviderSourceToWorkspace(input: {
  workspaceId: string;
  sourceId: string;
}) {
  const db = getDb();
  const sources = await scanProviderImportSources();
  const source = sources.find((candidate) => candidate.id === input.sourceId);
  if (!source) throw new Error(`Unknown provider source: ${input.sourceId}`);
  if (!source.importableProvider) {
    throw new Error(`Provider source "${source.label}" is detectable but not importable.`);
  }

  const existing = await db.listModelInstallationsByWorkspace(input.workspaceId);
  const duplicate = existing.find(
    (candidate) =>
      candidate.providerKind === source.importableProvider?.providerKind &&
      candidate.baseUrl === source.importableProvider?.baseUrl &&
      candidate.apiKey === source.importableProvider?.apiKey,
  );
  if (duplicate) return duplicate;

  return db.createModelInstallation({
    workspaceId: input.workspaceId,
    label: source.importableProvider.label,
    providerKind: source.importableProvider.providerKind,
    baseUrl: source.importableProvider.baseUrl,
    apiKey: source.importableProvider.apiKey,
    modelIds: source.importableProvider.modelIds,
    enabled: true,
  });
}
