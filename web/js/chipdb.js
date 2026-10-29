// Chip and machine reference data, seeded into the catalog SQLite (tables chips, chip_variants, machines, machine_slots).
// Rows only describe and select; chip behaviour lives in the emulator cores. Part numbers come from the LSI test master list
// and atarihq.com/danb/atarichips.shtml; verified=0 means not yet checked against a primary document.
(function () {
  const SCHEMA_VERSION = 1;
  // [id, name, role, notes]
  const CHIPS = [
    ['cpu', '6502 family', 'CPU', '8-bit CPU. Sally (C014806) is the 6502C variant with a HALT line so ANTIC can take bus cycles.'],
    ['antic', 'ANTIC', 'Video DMA / display list processor', 'Reads the display list and fetches screen data; steals cycles from the CPU.'],
    ['gtia', 'GTIA/CTIA', 'Video output, player/missile graphics, collisions', 'CTIA in the 400/800, GTIA in later machines (adds modes 9-11).'],
    ['pokey', 'POKEY', 'Sound, keyboard, serial I/O, paddles, random numbers', 'Four audio channels, SIO shift register, keyboard scan, POT inputs, IRQs.'],
    ['pia', 'PIA (6520)', 'Joystick ports, SIO control lines, banking (PORTB on XL/XE)', 'Ports A and B; PORTB controls OS/BASIC ROM and XE extended-RAM banking.'],
    ['mmu', 'FREDDIE / MMU', 'DRAM refresh and memory control on XL/XE', 'Replaces the discrete RAM control logic of the 400/800.'],
    ['maria', 'MARIA', 'Atari 7800 graphics', '7800 only; works with TIA for 2600 compatibility.'],
    ['tia', 'TIA', 'Atari 2600 video/audio', 'Present in the 7800 for 2600 mode.'],
    ['riot', 'RIOT (6532)', 'RAM, I/O, timer', '7800 and 2600 console I/O.'],
  ];
  // [chip_id, variant, part_no, machines (text), notes, verified]
  const VARIANTS = [
    ['cpu', '6502B', '', '400/800/5200', '1.79 MHz NTSC', 0],
    ['cpu', '6502C (Sally)', 'C014806', '1200XL/800XL/XE/XEGS/7800', 'HALT pin; 1.79 MHz NTSC, 1.77 MHz PAL', 1],
    ['antic', 'ANTIC', 'C012296', '400/800/XL/XE', 'NTSC', 1],
    ['antic', 'ANTIC-E', 'C021697', 'later XL/XE', 'listed in the LSI test master list', 0],
    ['gtia', 'CTIA', 'C012295', '400/800 (early)/5200', 'No GTIA modes 9-11', 0],
    ['gtia', 'GTIA', 'C014805', '400/800 (late)/XL/XE/5200', 'Adds modes 9, 10, 11', 1],
    ['pokey', 'POKEY', 'C012294', 'all 8-bit machines, 5200, some 7800 carts', '', 1],
    ['pia', 'PIA 6520', 'C014795', '400/800/XL/XE', '', 1],
    ['mmu', 'FREDDIE', 'C061922', 'XL/XE', 'listed in the LSI test master list', 0],
    ['maria', 'MARIA', '', '7800', '', 0],
    ['tia', 'TIA', '', '7800', '', 0],
    ['riot', 'RIOT 6532', '', '7800', '', 0],
  ];
  // [id, name, family, year, ram_kb, notes]
  const MACHINES = [
    ['400', 'Atari 400', '8-bit', 1979, 16, 'Membrane keyboard; CTIA/GTIA, ANTIC, POKEY, PIA'],
    ['800', 'Atari 800', '8-bit', 1979, 48, 'Two cartridge slots, four joystick ports; OS ROM on a plug-in board'],
    ['1200xl', 'Atari 1200XL', '8-bit', 1982, 64, 'OS revision 10 (A); first XL'],
    ['800xl', 'Atari 800XL', '8-bit', 1983, 64, 'Built-in BASIC; OS revision 2 (B) common'],
    ['65xe', 'Atari 65XE', '8-bit', 1985, 64, 'XL/XE family'],
    ['130xe', 'Atari 130XE', '8-bit', 1985, 128, 'ECI port; 4 x 16 KB extended banks'],
    ['xegs', 'Atari XEGS', '8-bit', 1987, 64, 'Console with detachable keyboard'],
    ['5200', 'Atari 5200', 'console', 1982, 16, 'Shared hardware with the 8-bit family; analog joysticks'],
    ['7800', 'Atari 7800', 'console', 1986, 4, 'MARIA, TIA, RIOT, optional POKEY on cart'],
  ];
  // [machine_id, slot, chip_id, variant]
  const SLOTS = [];
  const slots = (m, list) => list.forEach(([slot, chip, variant]) => SLOTS.push([m, slot, chip, variant]));
  for (const m of ['400', '800']) slots(m, [['CPU', 'cpu', '6502B'], ['ANTIC', 'antic', 'ANTIC'], ['GTIA', 'gtia', 'CTIA or GTIA'], ['POKEY', 'pokey', 'POKEY'], ['PIA', 'pia', 'PIA 6520']]);
  for (const m of ['1200xl', '800xl', '65xe', '130xe', 'xegs']) slots(m, [['CPU', 'cpu', '6502C (Sally)'], ['ANTIC', 'antic', 'ANTIC'], ['GTIA', 'gtia', 'GTIA'], ['POKEY', 'pokey', 'POKEY'], ['PIA', 'pia', 'PIA 6520'], ['MMU', 'mmu', 'FREDDIE']]);
  slots('5200', [['CPU', 'cpu', '6502B'], ['ANTIC', 'antic', 'ANTIC'], ['GTIA', 'gtia', 'GTIA'], ['POKEY', 'pokey', 'POKEY']]);
  slots('7800', [['CPU', 'cpu', '6502C (Sally)'], ['Video', 'maria', 'MARIA'], ['2600 video', 'tia', 'TIA'], ['I/O', 'riot', 'RIOT 6532']]);

  const DDL = `
    CREATE TABLE IF NOT EXISTS chips (id TEXT PRIMARY KEY, name TEXT, role TEXT, notes TEXT);
    CREATE TABLE IF NOT EXISTS chip_variants (chip_id TEXT, variant TEXT, part_no TEXT, machines TEXT, notes TEXT, verified INTEGER DEFAULT 0, PRIMARY KEY (chip_id, variant));
    CREATE TABLE IF NOT EXISTS machines (id TEXT PRIMARY KEY, name TEXT, family TEXT, year INTEGER, ram_kb INTEGER, notes TEXT);
    CREATE TABLE IF NOT EXISTS machine_slots (machine_id TEXT, slot TEXT, chip_id TEXT, variant TEXT, PRIMARY KEY (machine_id, slot));`;

  // Called by the catalog after every open; reseeds only when the stored schema version is older.
  function seed(db) {
    db.run(DDL);
    const cur = db.exec("SELECT v FROM meta WHERE k='chipdb_version'");
    if (cur.length && +cur[0].values[0][0] >= SCHEMA_VERSION) return;
    db.run('BEGIN');
    for (const t of ['chips', 'chip_variants', 'machines', 'machine_slots']) db.run('DELETE FROM ' + t);
    const ins = (sql, rows) => { const st = db.prepare(sql); for (const r of rows) st.run(r); st.free(); };
    ins('INSERT INTO chips VALUES (?,?,?,?)', CHIPS);
    ins('INSERT INTO chip_variants VALUES (?,?,?,?,?,?)', VARIANTS);
    ins('INSERT INTO machines VALUES (?,?,?,?,?,?)', MACHINES);
    ins('INSERT INTO machine_slots VALUES (?,?,?,?)', SLOTS);
    db.run("INSERT OR REPLACE INTO meta (k,v) VALUES ('chipdb_version', ?)", [String(SCHEMA_VERSION)]);
    db.run('COMMIT');
  }

  window.AC = window.AC || {};
  AC.ChipDB = { seed, SCHEMA_VERSION };
})();
