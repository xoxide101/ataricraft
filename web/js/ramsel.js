// RAM dropdown follows the selected core: sizes a core cannot emulate stay listed but disabled, with the reason as a tooltip.
// The user's pick is remembered across core switches (it is only replaced by the model default while it is unavailable).
(function () {
  const $ = (id) => document.getElementById(id);
  const sel = $('ram');
  if (!sel || !$('core') || !window.AC || !AC.MODELS) return;
  let pref = sel.value, busy = false;
  const reasonFor = (v) => {
    const m = AC.MODELS[$('model').value];
    const r = m && m.ram.find((x) => x.v === v);
    return (r && r.no && r.no[$('core').value]) || '';
  };
  function refresh() {
    busy = true;
    const m = AC.MODELS[$('model').value];
    for (const o of sel.options) {
      if (o.dataset.label === undefined) o.dataset.label = o.textContent;
      const why = reasonFor(o.value);
      o.disabled = !!why;
      o.title = why;
      o.textContent = why ? o.dataset.label + ' (not on this core)' : o.dataset.label;
    }
    const want = [...sel.options].find((o) => o.value === pref && !o.disabled);
    if (want) sel.value = pref;
    else if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = m.def;
    busy = false;
  }
  sel.addEventListener('change', () => { if (!busy) pref = sel.value; });
  $('core').addEventListener('change', refresh);
  // The model change rebuilds the list (and keeps or resets the value itself), so that value becomes the new preference.
  new MutationObserver(() => { if (!busy) { pref = sel.value; refresh(); } }).observe(sel, { childList: true });
  refresh();
})();
