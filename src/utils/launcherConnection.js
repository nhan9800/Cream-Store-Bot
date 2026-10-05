// A SIGKILLed launcher cannot run its shutdown handler. Its forked stores must
// still release Discord/HTTP resources instead of surviving as orphaned bots.
export function watchLauncherConnection(stopChild) {
  if (typeof process.send !== 'function') return;
  const stop = () => { void stopChild('PARENT_DISCONNECT'); };
  process.once('disconnect', stop);
  if (!process.connected) stop();
}
