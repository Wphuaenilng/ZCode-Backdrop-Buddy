export class KeyedMutex {
  constructor() {
    this.chains = new Map();
  }

  run(key, task) {
    const previous = this.chains.get(key) || Promise.resolve();
    const current = previous.then(task, task);
    const guard = current.catch(() => {});
    this.chains.set(key, guard);
    guard.finally(() => {
      if (this.chains.get(key) === guard) this.chains.delete(key);
    });
    return current;
  }
}
