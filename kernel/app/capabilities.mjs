// file.pick and the shell.* settings calls never reach the kernel's registry.
const SHELL_METHODS = Object.freeze(['file.pick', 'shell.settings.get', 'shell.settings.set']);

export function buildCapabilities(registry) {
  return registry.list().filter((method) => method !== 'system.shutdown' && !SHELL_METHODS.includes(method));
}

export function shellMethods() {
  return [...SHELL_METHODS];
}
