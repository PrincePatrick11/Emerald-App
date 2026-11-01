/** The translation key for a sync error code from `sync.rs` or the server. */
export function syncErrorKey(code: string): string {
  switch (code) {
    case 'SYNC_UNREACHABLE': return 'sync.errorUnreachable';
    case 'SYNC_INSECURE': return 'sync.errorInsecure';
    case 'SYNC_WRONG_LOGIN': return 'sync.errorWrongLogin';
    case 'SYNC_NEEDS_LOGIN': return 'sync.needsLogin';
    case 'SYNC_SERVER:client_outdated': return 'sync.errorOutdated';
    case 'SYNC_SERVER:signup_closed': return 'sync.errorSignupClosed';
    case 'SYNC_SERVER:username_taken': return 'sync.errorUsernameTaken';
    case 'SYNC_SERVER:bad_password': return 'sync.errorBadPassword';
    case 'SYNC_SERVER:bad_username': return 'sync.errorBadUsername';
    case 'SYNC_SERVER:locked':
    case 'SYNC_SERVER:busy': return 'sync.errorBusy';
    default: return 'sync.errorFailed';
  }
}
