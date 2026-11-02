/** The translation key for a sync error code from `sync.rs` or the server. */
export function syncErrorKey(code: string): string {
  switch (code) {
    case 'SYNC_UNREACHABLE': return 'sync.errorUnreachable';
    case 'SYNC_INSECURE': return 'sync.errorInsecure';
    case 'SYNC_WRONG_KEY':
    case 'SYNC_SERVER:wrong_key': return 'sync.errorWrongKey';
    case 'SYNC_NEEDS_LOGIN': return 'sync.needsLogin';
    case 'SYNC_SERVER:not_found': return 'sync.goneFromServer';
    case 'SYNC_PASSWORD_CHANGED': return 'sync.passwordChanged';
    case 'WRONG_PASSWORD': return 'vaultKey.wrongPassword';
    case 'SYNC_SERVER:client_outdated': return 'sync.errorOutdated';
    default: return 'sync.errorFailed';
  }
}
