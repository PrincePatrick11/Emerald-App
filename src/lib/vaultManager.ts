import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';

export interface Vault {
  id: string;        // 'default' for the original DB, UUID for others
  name: string;      // user-editable display name
  dbName: string;    // SQLite filename, e.g. 'emerald.db' or 'emerald-abc123.db'
  createdAt: string; // ISO timestamp
}

interface VaultsFile {
  vaults: Vault[];
  activeVaultId: string;
}

let _cached: VaultsFile | null = null;
let _vaultsPath: string | null = null;

async function getVaultsPath(): Promise<string> {
  if (_vaultsPath) return _vaultsPath;
  const dir = await appDataDir();
  // Normalize trailing separator
  _vaultsPath = dir.endsWith('/') || dir.endsWith('\\')
    ? `${dir}vaults.json`
    : `${dir}/vaults.json`;
  return _vaultsPath;
}

const DEFAULT_VAULT: Vault = {
  id: 'default',
  name: 'Emerald',
  dbName: 'emerald.db',
  createdAt: new Date(0).toISOString(),
};

export async function loadVaultsFile(): Promise<VaultsFile> {
  if (_cached) return _cached;

  const path = await getVaultsPath();
  try {
    const raw = await invoke<string>('read_file', { path });
    const parsed = JSON.parse(raw) as VaultsFile;
    // Ensure the default vault is always present
    if (!parsed.vaults.find((v) => v.id === 'default')) {
      parsed.vaults.unshift(DEFAULT_VAULT);
    }
    _cached = parsed;
    return _cached;
  } catch {
    // File doesn't exist yet — bootstrap with default vault
    const data: VaultsFile = {
      vaults: [DEFAULT_VAULT],
      activeVaultId: 'default',
    };
    await saveVaultsFile(data);
    return data;
  }
}

export async function saveVaultsFile(data: VaultsFile): Promise<void> {
  const path = await getVaultsPath();
  await invoke('write_file', { path, content: JSON.stringify(data, null, 2) });
  _cached = data;
}

export async function getActiveDbName(): Promise<string> {
  const data = await loadVaultsFile();
  const active = data.vaults.find((v) => v.id === data.activeVaultId);
  return active?.dbName ?? 'emerald.db';
}

export async function getActiveVaultId(): Promise<string> {
  const data = await loadVaultsFile();
  return data.activeVaultId;
}

export async function setActiveVaultId(id: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, activeVaultId: id });
}

/** Build the record for a brand new vault — each one gets its own SQLite file. */
export function newVaultRecord(name: string): Vault {
  const id = crypto.randomUUID();
  return {
    id,
    name,
    dbName: `emerald-${id}.db`,
    createdAt: new Date().toISOString(),
  };
}

export async function addVault(vault: Vault): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, vaults: [...data.vaults, vault] });
}

export async function updateVaultName(id: string, name: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({
    ...data,
    vaults: data.vaults.map((v) => (v.id === id ? { ...v, name } : v)),
  });
}

export async function removeVault(id: string): Promise<void> {
  const data = await loadVaultsFile();
  await saveVaultsFile({ ...data, vaults: data.vaults.filter((v) => v.id !== id) });
}

/** Invalidate in-memory cache (e.g. after an external write). */
export function invalidateVaultCache(): void {
  _cached = null;
}
