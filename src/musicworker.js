// The voices' renderer (Plan J §3.5, musicvoices.js): the pure-JS synthesis of every octave buffer, off the main thread
// (about half a second of work on the Air, which in idle slices stalled the frames for 10-90 ms each). Made by
// Voices.prerender as a module worker (new URL('./musicworker.js?v=<version>', import.meta.url)), terminated by it once
// the last buffer is back; on any failure Voices goes on with the idle slices.
// Main thread → worker: { t: 'render', jobs: [[voice, octave index], …] }
// Worker → main thread: { t: 'part', voice, i, data: Float32Array (transferred), sr, base, loop, midi } per job, in the
//   order asked ({ t: 'part', voice, i, error } if one failed), then { t: 'done' }
import { renderPart } from './musicvoices.js';

onmessage = e => {
  const m = e.data;
  if (!m || m.t !== 'render' || !Array.isArray(m.jobs)) return;
  for (const job of m.jobs) {
    const voice = String(job?.[0]), i = job?.[1] | 0;
    try {
      const o = renderPart(voice, i);
      if (o) postMessage({ t: 'part', voice, i, data: o.data, sr: o.sr, base: o.base, loop: o.loop, midi: o.midi }, [o.data.buffer]);
      else postMessage({ t: 'part', voice, i, error: 'unknown voice' });
    } catch (err) { postMessage({ t: 'part', voice, i, error: String(err?.message || err) }); }
  }
  postMessage({ t: 'done' });
};
