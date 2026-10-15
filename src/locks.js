// A tiny in-process, per-key mutex. It makes "check version, then write" atomic with
// respect to other tool calls in this process. (One server process only: see README.)
const tails = new Map();

export function lockKey(absPath) {
  return process.platform === "win32" ? absPath.toLowerCase() : absPath;
}

export async function withLock(key, fn) {
  const previous = tails.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
