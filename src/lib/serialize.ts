/**
 * Reiht asynchrone Aufgaben mit demselben Schlüssel strikt hintereinander.
 *
 * Wozu: Die Update-Methoden der Content-Stores lesen einen Snapshot aus dem
 * Store, mischen den Patch ein und schreiben die KOMPLETTE Zeile zurück in die
 * Datenbank. Überlappen sich zwei Updates für denselben Eintrag (z. B.
 * Editor-Autosave und ein Property-Wechsel aus der Sidebar), holt der zweite
 * seinen Snapshot, bevor der erste den Store aktualisiert hat — sein UPDATE
 * überschreibt dann die frisch gespeicherten Felder des ersten mit dem alten
 * Stand. Serialisiert pro Eintrags-ID startet der zweite erst, wenn der erste
 * inklusive `set()` durch ist, und sieht dessen Ergebnis im Snapshot.
 *
 * Schlüssel kommen aus `serialKey`, damit dieselbe Domäne nicht unter zwei
 * Schreibweisen läuft. Eine Aufgabe darf unter ihrem eigenen Schlüssel keine
 * weitere serialisierte Aufgabe awaiten — das wartete auf sich selbst und
 * stünde für immer. Die Kette hat bewusst kein Timeout: eine Aufgabe, die nie
 * settlet, belegt ihren Schlüssel dauerhaft.
 */
const tails = new Map<string, Promise<void>>();

export function serialKey(
  domain:
    | 'journal' | 'wiki' | 'operation' | 'task' | 'tag' | 'routine'
    | 'altar' | 'altarItem' | 'placement' | 'links',
  id: string,
): string {
  return `${domain}:${id}`;
}

/**
 * Wartet, bis alle aktuell eingereihten Ketten leergelaufen sind. Für die
 * Momente, in denen die Datenbank unter den Stores ausgetauscht wird
 * (Vault-Wechsel, Replace-Import): Aufgaben, die danach noch einreihen, muss
 * der Aufrufer selbst unterbinden (Editor-Sperre, Navigation weg vom Eintrag).
 */
export function drainSerialized(): Promise<void> {
  return Promise.all([...tails.values()]).then(() => undefined);
}

export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  // Das gemerkte Kettenende ist fehlerbehandelt — ein gescheitertes Update darf
  // die Nachfolger nicht mitreißen. Geloggt wird hier trotzdem: viele Aufrufer
  // sind Fire-and-forget, und weil der Tail die Rejection „behandelt", gäbe es
  // sonst nicht einmal mehr die Unhandled-Rejection-Meldung in der Konsole.
  // Der Aufrufer selbst sieht die Ablehnung seiner eigenen Aufgabe unverändert.
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(task);
  const tail = run.then(
    () => undefined,
    (err) => { console.error(`[serialized] ${key} failed:`, err); },
  );
  tails.set(key, tail);
  // Abgearbeitete Ketten aus der Map räumen, sonst wächst sie mit jeder je
  // angefassten ID weiter.
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
