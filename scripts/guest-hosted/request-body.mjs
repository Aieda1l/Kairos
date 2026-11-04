// Pure request-body validation shared by the guard and the independent private fixture.
// A successful read consumes only a clone. Rejection disposes both tee branches.
export async function readChallengeBody(request, maximumBytes = 16384) {
  const failure = () => new Error('GUEST_REQUEST_BODY_DENIED');
  if (request.signal.aborted || !request.body) throw failure();
  const clone = request.clone();
  const reader = clone.body.getReader();
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  // The signal may already change before the first race is installed.
  void aborted.catch(() => {});
  const onAbort = () => rejectAbort(failure());
  request.signal.addEventListener('abort', onAbort, {once: true});
  if (request.signal.aborted) onAbort();
  let completed = false;
  try {
    let bytes = 0, text = '';
    const decoder = new TextDecoder();
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (request.signal.aborted) throw failure();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) throw failure();
      text += decoder.decode(next.value, {stream: true});
    }
    text += decoder.decode();
    completed = true;
    return text;
  } catch {
    throw failure();
  } finally {
    request.signal.removeEventListener('abort', onAbort);
    if (!completed) {
      // Tee cancellation promises can wait for the other branch (or the source).
      // Start both, handle rejection, and never await either during validation.
      try { void reader.cancel().catch(() => {}); } catch { /* Best effort disposal. */ }
      try { void request.body.cancel().catch(() => {}); } catch { /* Already locked/closed. */ }
    }
    reader.releaseLock();
  }
}
