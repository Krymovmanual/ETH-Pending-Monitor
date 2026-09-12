// Loaded before the application: even a parse error must have a visible outcome.
(() => {
  function show(message) {
    const panel = document.getElementById('startupDiagnostic');
    if (!panel) return;
    panel.hidden = false;
    panel.querySelector('p').textContent = message;
  }
  window.addEventListener('error', event => {
    show(event.target?.tagName === 'SCRIPT'
      ? 'Application file could not load. Check your connection and reload. Your saved settings have not been cleared.'
      : 'Application encountered an error. Reload to retry. If it repeats, share the first red error from the browser Console, with keys and tokens hidden.');
  }, true);
  window.addEventListener('unhandledrejection', () => show('An operation failed unexpectedly. Saved settings remain. Check the connection status and retry.'));
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('retryStartup')?.addEventListener('click', () => location.reload());
    if (!window.treasuryBootComplete && !window.treasurySessionLoading) show('Application startup did not finish. Reload this page to obtain the latest application files.');
  });
})();
