export function createContext(parts) {
  return {
    startedAt: Date.now(),
    ...parts
  };
}
