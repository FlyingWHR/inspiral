// Voxel colour system — generated. Drop straight into three.js.
// new THREE.Color(PALETTES.emberlightTavern.structA)  (colours are sRGB hex)

export const VALUE_LADDER = {"VOID": 0.19, "DARK": 0.32, "MID": 0.48, "LIGHT": 0.64, "HIGH": 0.8, "BACKDROP": null};

export const CHARACTER = {
  chrDeep: '#3a1819',   // L=0.26  Hair, boots, outline mass. Darker than any environment MID.
  chrCloth: '#902d5a',   // L=0.46  Signature garment. RESERVED HUE BAND - see rule R4. Largest character mass.
  chrSkin: '#a86753',   // L=0.58  Skin. Deliberately a SMALL mass - see the note on skin collisions.
  chrTrim: '#00b5b5',   // L=0.70  Secondary read: straps, pack, weapon wrap. Cool, so it survives warm rooms.
  chrLight: '#c3d4dd',   // L=0.86  Cool ivory. Brightest thing at eye level, and hue-separated from every flame.
} as const;

export const PALETTES = {
  emberlightTavern: {  // Emberlight Tavern — A low room lit by one fire, with the cold blue night pressing at the windows.
    void: '#170e25',            // VOID     L=0.19
    groundA: '#432c28',         // DARK     L=0.32
    groundB: '#412638',         // DARK     L=0.31
    structA: '#775541',         // MID      L=0.48
    structB: '#4d6053',         // MID      L=0.47
    structC: '#4d586d',         // MID      L=0.46
    fieldA: '#aa845c',          // LIGHT    L=0.64
    fieldB: '#a67e75',          // LIGHT    L=0.63
    highA: '#dab884',           // HIGH     L=0.80
    highB: '#a3bed9',           // HIGH     L=0.79
    backdrop: '#1d2d4c',        // BACKDROP L=0.30
    accentHot: '#d75a21',       // MID/LIGHT L=0.62
    accentCool: '#00629e',      // MID/LIGHT L=0.48
    emissive: '#ffda7d',        // HIGH+    L=0.90
  },
  cinderCouncil: {  // Cinder Council — A cold stone chamber where the only warmth is institutional: candle, gold, and the red of office.
    void: '#0c1325',            // VOID     L=0.19
    groundA: '#273442',         // DARK     L=0.32
    groundB: '#342c40',         // DARK     L=0.31
    structA: '#51606d',         // MID      L=0.48
    structB: '#4d5f5f',         // MID      L=0.47
    structC: '#704e47',         // MID      L=0.46
    fieldA: '#7c8f9d',          // LIGHT    L=0.64
    fieldB: '#8e897a',          // LIGHT    L=0.63
    highA: '#afc1cd',           // HIGH     L=0.80
    highB: '#ccb79a',           // HIGH     L=0.79
    backdrop: '#e5f1f7',        // BACKDROP L=0.95
    accentHot: '#a93622',       // MID/LIGHT L=0.50
    accentCool: '#007f94',      // MID/LIGHT L=0.55
    emissive: '#ffcc69',        // HIGH+    L=0.87
  },
  saffronMarket: {  // Saffron Market — Midday. Bleached stone, hard blue shadow, and cloth doing all the shouting.
    void: '#0e132d',            // VOID     L=0.20
    groundA: '#29354d',         // DARK     L=0.33
    groundB: '#4c2623',         // DARK     L=0.32
    structA: '#7b533f',         // MID      L=0.48
    structB: '#44634c',         // MID      L=0.47
    structC: '#385b7e',         // MID      L=0.46
    fieldA: '#a28c63',          // LIGHT    L=0.65
    fieldB: '#6b9a71',          // LIGHT    L=0.64
    highA: '#d0c093',           // HIGH     L=0.81
    highB: '#98c6d9',           // HIGH     L=0.80
    backdrop: '#60aedf',        // BACKDROP L=0.72
    accentHot: '#e25500',       // MID/LIGHT L=0.63
    accentCool: '#00736b',      // MID/LIGHT L=0.50
    emissive: '#fae8a3',        // HIGH+    L=0.93
  },
  saltHarbourDawn: {  // Salt Harbour Dawn — Wet stone, low fog, and a rose sun that has not cleared the roofline yet.
    void: '#0a1326',            // VOID     L=0.19
    groundA: '#243543',         // DARK     L=0.32
    groundB: '#392a3d',         // DARK     L=0.31
    structA: '#515f71',         // MID      L=0.48
    structB: '#4b605a',         // MID      L=0.47
    structC: '#724d4b',         // MID      L=0.46
    fieldA: '#818ca6',          // LIGHT    L=0.64
    fieldB: '#96809c',          // LIGHT    L=0.63
    highA: '#dfb3a0',           // HIGH     L=0.80
    highB: '#a9bdd4',           // HIGH     L=0.79
    backdrop: '#9694b6',        // BACKDROP L=0.68
    accentHot: '#f75d57',       // MID/LIGHT L=0.68
    accentCool: '#007492',      // MID/LIGHT L=0.52
    emissive: '#ffcd94',        // HIGH+    L=0.88
  },
  thornwoodNightfall: {  // Thornwood Nightfall — Last blue light under a canopy, with one lamp doing the work of a sun.
    void: '#0e1129',            // VOID     L=0.19
    groundA: '#1f2f44',         // DARK     L=0.30
    groundB: '#063428',         // DARK     L=0.29
    structA: '#42536e',         // MID      L=0.44
    structB: '#345944',         // MID      L=0.43
    structC: '#534662',         // MID      L=0.42
    fieldA: '#5d7f9b',          // LIGHT    L=0.58
    fieldB: '#588366',          // LIGHT    L=0.57
    highA: '#77adc9',           // HIGH     L=0.72
    highB: '#98a886',           // HIGH     L=0.71
    backdrop: '#5d6499',        // BACKDROP L=0.52
    accentHot: '#d16e00',       // MID/LIGHT L=0.64
    accentCool: '#00818c',      // MID/LIGHT L=0.55
    emissive: '#ffdca1',        // HIGH+    L=0.91
  },
} as const;