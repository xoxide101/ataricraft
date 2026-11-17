// Keyboard diagnostics (rollover, event rate, hold times, special keys) and macro-key maps. DOM-free so it runs in Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); else root.CtrlKbd = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Keys that are not part of a normal typing block: media/knob, F13-F24 (the usual target for macro keys) and system keys.
  const SPECIAL_RE = /^(F(1[3-9]|2[0-4])|Audio\w+|Media\w+|Volume\w+|Launch\w+|Browser\w+|BrightnessUp|BrightnessDown|Lang\d|Intl\w+|Convert|NonConvert|KanaMode|ContextMenu|Fn|FnLock|Power|Sleep|WakeUp|Help|Again|Props|Undo|Cut|Copy|Paste|Find|Open|Select)$/;
  const isSpecial = (code) => SPECIAL_RE.test(code || '');

  // 8 macro slots = the keyboard's G1-G4 (left side, top to bottom) and G5-G8 (bottom row, left to right).
  // The NuPhyIO Basic list has no F13+, so the defaults are numpad keys, which do not exist on this 75% board.
  const MACRO_SLOTS = [
    { id: 'G1', label: 'Side 1', action: 'start', code: 'Numpad1' }, { id: 'G2', label: 'Side 2', action: 'select', code: 'Numpad2' },
    { id: 'G3', label: 'Side 3', action: 'option', code: 'Numpad3' }, { id: 'G4', label: 'Side 4', action: 'reset', code: 'Numpad4' },
    { id: 'G5', label: 'Bottom 1', action: 'pause', code: 'Numpad5' }, { id: 'G6', label: 'Bottom 2', action: 'break', code: 'Numpad6' },
    { id: 'G7', label: 'Bottom 3', action: 'help', code: 'Numpad7' }, { id: 'G8', label: 'Bottom 4', action: 'credit', code: 'Numpad8' },
  ];

  const KEYBOARDS = {
    'nuphy-field75-he-v2': {
      label: 'NuPhy Field75 HE V2 (75%, 83 keys, Hall effect)',
      keys: 83, wiredOnly: true, pollingHz: 8000, rollover: 'NKRO',
      macroSlots: 8,
      notes: [
        'In NuPhyIO > Key Bindings, assign G1-G8 (side and bottom keys) to Numpad 1-8 (Basic list). They are not on a 75% board, so they never clash with typing. The Basic list has no F13-F20.',
        'Rapid Trigger and SOCD run in the keyboard firmware: opposing keys (left/right, up/down) may be cleaned or re-fired before the emulator sees them. Turn them off for joystick use or test with the held-keys view.',
        '8000 Hz polling can deliver bursts of events; the rate meter below shows the peak seen by the browser (browsers usually coalesce well below 8000).',
        'The knob normally sends volume keys (AudioVolumeUp/Down, mute). They are listed as special keys and are not bound by default.',
        'The M1/M2/M3 mode switch changes the on-board layer; macro codes only appear on the layer you configured.',
      ],
    },
    'generic-nkro': { label: 'Generic keyboard', keys: 0, wiredOnly: false, pollingHz: 0, rollover: 'unknown', macroSlots: 8, notes: [] },
  };

  // Tracks what the keyboard actually delivers. Feed it down/up with a timestamp in ms.
  function createStats() {
    const S = { held: new Set(), peak: 0, downs: 0, ups: 0, special: new Map(), seen: new Set(), holds: new Map(), downAt: new Map(), recent: [], peakRate: 0, shortest: null };
    S.down = (code, t, repeat) => {
      if (repeat) return;
      S.downs++; S.seen.add(code); S.held.add(code); S.downAt.set(code, t);
      if (S.held.size > S.peak) S.peak = S.held.size;
      if (isSpecial(code) || MACRO_SLOTS.some((s) => s.code === code)) S.special.set(code, (S.special.get(code) || 0) + 1);
      S.recent.push(t); while (S.recent.length && t - S.recent[0] > 1000) S.recent.shift();
      if (S.recent.length > S.peakRate) S.peakRate = S.recent.length;
    };
    S.up = (code, t) => {
      S.ups++; S.held.delete(code);
      if (S.downAt.has(code)) {
        const d = t - S.downAt.get(code); S.downAt.delete(code);
        if (d >= 0) { const h = S.holds.get(code) || { n: 0, min: Infinity, max: 0 }; h.n++; h.min = Math.min(h.min, d); h.max = Math.max(h.max, d); S.holds.set(code, h); if (S.shortest === null || d < S.shortest) S.shortest = d; }
      }
    };
    // Release everything (window blur): avoids stuck keys in the report.
    S.reset = () => { S.held.clear(); S.downAt.clear(); };
    S.report = () => ({ held: [...S.held], peak: S.peak, downs: S.downs, ups: S.ups, peakPerSec: S.peakRate, shortestHoldMs: S.shortest, distinct: S.seen.size, special: [...S.special.entries()].map(([code, n]) => ({ code, n })) });
    return S;
  }

  // Rollover verdict: given the peak simultaneous keys the user held during a test.
  function rolloverVerdict(peak) {
    if (peak < 2) return 'Hold several keys at once to measure rollover.';
    if (peak >= 10) return 'Full N-key rollover (' + peak + ' keys held at once).';
    if (peak >= 6) return peak + '-key rollover (6KRO or better).';
    return 'Only ' + peak + ' keys registered at once: possible ghosting or a rollover limit (try the other USB port/cable or the wired mode).';
  }

  // Aux bindings for the macro keys: [{source:['kb:F13'], action:'start'}, ...] in slot order.
  function macroBindings(slots) {
    return (slots || MACRO_SLOTS).map((s) => ({ source: s.code ? ['kb:' + s.code] : [], action: s.action }));
  }

  return { isSpecial, MACRO_SLOTS, KEYBOARDS, createStats, rolloverVerdict, macroBindings };
});
