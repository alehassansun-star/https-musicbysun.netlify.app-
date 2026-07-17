/**
 * MUSIC BY SUN — script.js
 * Fixed guitar (Karplus-Strong v2), harmonium (additive),
 * Reverb (convolution IR), Music Styles, Math Patterns,
 * Volume/Decay/Tone controls, Visualizer
 */

'use strict';

// ════════════════════════════════════════════
// 1. AUDIO CONTEXT & NODE GRAPH
// ════════════════════════════════════════════
let ctx = null;
let masterGain, dryGain, wetGain, reverbNode, toneFilter, compressor;
let reverbBuffer = null;
let reverbEnabled = false;

function boot() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // Compressor → keeps sound clean, no distortion
  compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value      = 10;
  compressor.ratio.value     = 5;
  compressor.attack.value    = 0.003;
  compressor.release.value   = 0.25;
  compressor.connect(ctx.destination);

  // Tone (global low-pass) → warm/bright control
  toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 6000;
  toneFilter.Q.value = 0.5;
  toneFilter.connect(compressor);

  // Master gain
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;
  masterGain.connect(toneFilter);

  // Dry path
  dryGain = ctx.createGain();
  dryGain.gain.value = 1.0;
  dryGain.connect(masterGain);

  // Wet (reverb) path
  wetGain = ctx.createGain();
  wetGain.gain.value = 0;  // off by default
  wetGain.connect(masterGain);

  // Build reverb IR
  buildReverb();
}

function buildReverb(decaySec = 2.2) {
  if (!ctx) return;
  const sr = ctx.sampleRate;
  const length = sr * decaySec;
  const ir = ctx.createBuffer(2, length, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < length; i++) {
      // Exponential decay with diffusion
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  reverbBuffer = ir;

  if (reverbNode) reverbNode.disconnect();
  reverbNode = ctx.createConvolver();
  reverbNode.buffer = ir;
  reverbNode.connect(wetGain);
}

// Route a source through dry/wet
function routeSource(sourceNode) {
  sourceNode.connect(dryGain);
  if (reverbEnabled) sourceNode.connect(reverbNode);
}

// ════════════════════════════════════════════
// 2. NOTE & STYLE DEFINITIONS
// ════════════════════════════════════════════
const BASE_NOTES = [
  { key: 'a', note: 'C',  semitone: 0  },
  { key: 's', note: 'D',  semitone: 2  },
  { key: 'd', note: 'E',  semitone: 4  },
  { key: 'f', note: 'F',  semitone: 5  },
  { key: 'g', note: 'G',  semitone: 7  },
  { key: 'h', note: 'A',  semitone: 9  },
  { key: 'j', note: 'B',  semitone: 11 },
  { key: 'k', note: 'C',  semitone: 12 },
];

// Music style: modifies timbre/brightness/decay
const STYLES = {
  natural:   { brightness: 1.0,  decayMult: 1.0,  detune: 0,    vibrato: 0    },
  jazz:      { brightness: 0.7,  decayMult: 1.4,  detune: -5,   vibrato: 3    },
  classical: { brightness: 1.2,  decayMult: 1.8,  detune: 0,    vibrato: 1.5  },
  lofi:      { brightness: 0.5,  decayMult: 0.75, detune: -12,  vibrato: 0    },
};

function noteFreq(semitone, octave) {
  // A4 = 440 Hz, MIDI formula
  const midi = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ════════════════════════════════════════════
// 3. GUITAR SOUND ENGINE (Karplus-Strong v2)
//    Proper string pluck — warm, natural decay
// ════════════════════════════════════════════
function playGuitar(freq) {
  const style = STYLES[currentStyle];
  const sr = ctx.sampleRate;
  const now = ctx.currentTime;

  const decayTime = (params.decay / 50) * 2.5 * style.decayMult; // 0.5 – 5s

  // ---- Step 1: Short noise burst (pluck excitation) ----
  const exciteLen = Math.round(sr / freq);  // one period of noise
  const exciteBuf = ctx.createBuffer(1, exciteLen, sr);
  const exciteData = exciteBuf.getChannelData(0);
  for (let i = 0; i < exciteLen; i++) {
    exciteData[i] = Math.random() * 2 - 1;
  }

  // ---- Step 2: Longer "string body" buffer for resonance ----
  const bodyLen = Math.round(sr * 0.06);  // 60ms
  const bodyBuf = ctx.createBuffer(1, bodyLen, sr);
  const bodyData = bodyBuf.getChannelData(0);
  // Decaying sine at fundamental
  for (let i = 0; i < bodyLen; i++) {
    const t = i / sr;
    bodyData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-12 * t);
  }

  // Sources
  const excite = ctx.createBufferSource();
  excite.buffer = exciteBuf;
  const body = ctx.createBufferSource();
  body.buffer = bodyBuf;

  // ---- String low-pass (average adjacent samples = string stiffness) ----
  const strLP = ctx.createBiquadFilter();
  strLP.type = 'lowpass';
  strLP.frequency.value = freq * (2.8 * style.brightness);
  strLP.Q.value = 0.3;

  // ---- Body resonance boost ----
  const bodyPeak = ctx.createBiquadFilter();
  bodyPeak.type = 'peaking';
  bodyPeak.frequency.value = freq * 1.5;
  bodyPeak.gain.value = 4;
  bodyPeak.Q.value = 1.5;

  // ---- Highshelf cut (no harshness) ----
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3500;
  shelf.gain.value = -8;

  // ---- Gain envelope ----
  const gEnv = ctx.createGain();
  gEnv.gain.setValueAtTime(0, now);
  gEnv.gain.linearRampToValueAtTime(0.55, now + 0.004);  // instant attack
  gEnv.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

  // ---- Detune for style ----
  excite.detune.value = style.detune;
  body.detune.value = style.detune;

  // ---- Connect chain ----
  excite.connect(strLP);
  body.connect(strLP);
  strLP.connect(bodyPeak);
  bodyPeak.connect(shelf);
  shelf.connect(gEnv);
  routeSource(gEnv);

  excite.start(now);
  excite.stop(now + 0.04);
  body.start(now);
  body.stop(now + decayTime + 0.1);
}

// ════════════════════════════════════════════
// 4. HARMONIUM SOUND ENGINE
//    Reed-pipe additive + bellows LFO
// ════════════════════════════════════════════
function playHarmonium(freq) {
  const style = STYLES[currentStyle];
  const now = ctx.currentTime;
  const decayTime = (params.decay / 50) * 2.0 * style.decayMult;

  // Partials: reed organ spectrum
  const partials = [
    { type: 'sawtooth', mult: 1,   amp: 0.28 },
    { type: 'square',   mult: 1,   amp: 0.18 },
    { type: 'sawtooth', mult: 2,   amp: 0.14 },
    { type: 'square',   mult: 3,   amp: 0.07 },
    { type: 'sine',     mult: 4,   amp: 0.04 },
    { type: 'sine',     mult: 0.5, amp: 0.10 },
  ];

  // Warm LP for reed softness
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * (5 * style.brightness);
  lp.Q.value = 0.4;

  // Presence cut
  const shelf2 = ctx.createBiquadFilter();
  shelf2.type = 'highshelf';
  shelf2.frequency.value = 4000;
  shelf2.gain.value = -6;

  // Bellows tremolo LFO
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 5.0 + (style.vibrato || 0);

  // Envelope gain
  const gEnv = ctx.createGain();
  gEnv.gain.setValueAtTime(0, now);
  gEnv.gain.linearRampToValueAtTime(0.5, now + 0.07);
  gEnv.gain.setValueAtTime(0.5, now + 0.1);
  gEnv.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

  // LFO → modulate gain slightly
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.022;
  lfo.connect(lfoGain);
  lfoGain.connect(gEnv.gain);

  // Build partials
  partials.forEach(({ type, mult, amp }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq * mult;
    osc.detune.value = style.detune + (Math.random() * 2 - 1); // tiny humanize
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g);
    g.connect(lp);
    osc.start(now);
    osc.stop(now + decayTime + 0.15);
  });

  lp.connect(shelf2);
  shelf2.connect(gEnv);
  routeSource(gEnv);
  lfo.start(now);
  lfo.stop(now + decayTime + 0.15);
}

// ════════════════════════════════════════════
// 5. MATH-BASED CHORD PATTERNS
//    Ratios derived from just intonation / numbers
// ════════════════════════════════════════════
const CHORD_PATTERNS = [
  {
    name: 'Fibonacci',
    formula: '1·2·3·5·8',
    math: 'Fibonacci ratios',
    semitones: [0, 2, 5, 9, 16], // steps derived from fib sequence
  },
  {
    name: 'Prime',
    formula: '2·3·5·7',
    math: 'Prime number scale',
    semitones: [0, 2, 4, 7, 11],
  },
  {
    name: 'Major',
    formula: '4:5:6',
    math: 'Just intonation 4:5:6',
    semitones: [0, 4, 7],
  },
  {
    name: 'Minor',
    formula: '10:12:15',
    math: 'Just intonation minor',
    semitones: [0, 3, 7],
  },
  {
    name: 'Pythagorean',
    formula: '3/2 cycle',
    math: 'Circle of 5ths',
    semitones: [0, 7, 14, 21],
  },
  {
    name: 'Golden',
    formula: 'φ = 1.618',
    math: 'Golden ratio steps',
    semitones: [0, 5, 8, 13],
  },
  {
    name: 'Octave',
    formula: '1:2:4:8',
    math: 'Powers of 2',
    semitones: [0, 12, 24],
  },
  {
    name: 'Pentatonic',
    formula: '5-note',
    math: '5 equal divisions',
    semitones: [0, 2, 4, 7, 9],
  },
];

// ════════════════════════════════════════════
// 6. STATE
// ════════════════════════════════════════════
let currentInstrument = 'guitar';
let currentStyle      = 'natural';
let currentOctave     = 4;
const pressed         = new Set();

const params = { volume: 80, reverb: 15, decay: 50, tone: 65 };

// ════════════════════════════════════════════
// 7. BUILD KEYS UI
// ════════════════════════════════════════════
function buildKeys() {
  const container = document.getElementById('keys-container');
  container.innerHTML = '';

  BASE_NOTES.forEach(({ key, note, semitone }, i) => {
    const freq  = noteFreq(semitone, currentOctave);
    const label = semitone === 12 ? note + (currentOctave + 1) : note + currentOctave;

    const el = document.createElement('div');
    el.className = 'key';
    el.dataset.key = key;
    el.dataset.freq = freq;
    el.dataset.note = label;
    el.style.animationDelay = `${i * 0.055}s`;
    el.innerHTML = `<span class="note-lbl">${label}</span><span class="key-tag">${key.toUpperCase()}</span>`;

    el.addEventListener('mousedown', e => { e.preventDefault(); fireNote(key, parseFloat(el.dataset.freq), label, el); });
    el.addEventListener('touchstart', e => { e.preventDefault(); fireNote(key, parseFloat(el.dataset.freq), label, el); }, { passive: false });

    container.appendChild(el);
  });
}

// ════════════════════════════════════════════
// 8. BUILD CHORD BUTTONS
// ════════════════════════════════════════════
function buildChords() {
  const grid = document.getElementById('chord-grid');
  grid.innerHTML = '';

  CHORD_PATTERNS.forEach(chord => {
    const btn = document.createElement('button');
    btn.className = 'chord-btn';
    btn.innerHTML = `
      <span class="chord-name">${chord.name}</span>
      <span class="chord-formula">${chord.formula}</span>
      <span class="chord-math">${chord.math}</span>
    `;
    btn.addEventListener('click', () => playChord(chord));
    grid.appendChild(btn);
  });
}

function playChord(chord) {
  boot();
  chord.semitones.forEach((semi, i) => {
    const octShift = Math.floor(semi / 12);
    const s = semi % 12;
    const freq = noteFreq(s, currentOctave + octShift);
    setTimeout(() => {
      if (currentInstrument === 'guitar') playGuitar(freq);
      else playHarmonium(freq);

      // Highlight matching key if visible
      BASE_NOTES.forEach(n => {
        if (n.semitone === s) {
          const el = document.querySelector(`.key[data-key="${n.key}"]`);
          if (el) flashKey(el, n.note + (currentOctave + octShift));
        }
      });
    }, i * 90); // slight strum arpeggio
  });
}

// ════════════════════════════════════════════
// 9. FIRE A NOTE
// ════════════════════════════════════════════
function fireNote(key, freq, noteName, el) {
  boot();
  applyGain();
  if (currentInstrument === 'guitar') playGuitar(freq);
  else playHarmonium(freq);
  flashKey(el, noteName);
  updateNoteDisplay(noteName);
  addWave(freq);
}

function flashKey(el, noteName) {
  el.classList.add('active');
  // Ripple
  const old = el.querySelector('.rip');
  if (old) old.remove();
  const rip = document.createElement('span');
  rip.className = 'rip';
  rip.style.left = '50%'; rip.style.top = '40%';
  el.appendChild(rip);
  setTimeout(() => { el.classList.remove('active'); rip.remove(); }, 500);
}

// ════════════════════════════════════════════
// 10. KEYBOARD EVENTS
// ════════════════════════════════════════════
document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();

  // Reverb toggle via R key
  if (k === 'r') { toggleReverb(); return; }

  if (pressed.has(k)) return;
  pressed.add(k);

  const entry = BASE_NOTES.find(n => n.key === k);
  if (!entry) return;

  const el = document.querySelector(`.key[data-key="${k}"]`);
  if (!el) return;
  const freq = parseFloat(el.dataset.freq);
  const name = el.dataset.note;
  fireNote(k, freq, name, el);
});

document.addEventListener('keyup', e => pressed.delete(e.key.toLowerCase()));

// ════════════════════════════════════════════
// 11. INSTRUMENT SWITCHER
// ════════════════════════════════════════════
document.querySelectorAll('.pill[data-inst]').forEach(btn => {
  btn.addEventListener('click', () => {
    const inst = btn.dataset.inst;
    if (inst === currentInstrument) return;
    currentInstrument = inst;

    document.querySelectorAll('.pill[data-inst]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.body.classList.toggle('harm', inst === 'harmonium');
    document.getElementById('inst-label').textContent = inst === 'guitar' ? 'Guitar' : 'Harmonium';

    // Rebuild reverb to suit instrument
    if (ctx) {
      const dec = inst === 'harmonium' ? 2.8 : 2.0;
      buildReverb(dec);
    }
  });
});

// ════════════════════════════════════════════
// 12. STYLE SWITCHER
// ════════════════════════════════════════════
document.querySelectorAll('.pill[data-style]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentStyle = btn.dataset.style;
    document.querySelectorAll('.pill[data-style]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Rebuild reverb based on style
    if (ctx) {
      const decMap = { natural: 2.2, jazz: 1.5, classical: 3.5, lofi: 1.0 };
      buildReverb(decMap[currentStyle]);
    }
  });
});

// ════════════════════════════════════════════
// 13. OCTAVE STEPPER
// ════════════════════════════════════════════
document.getElementById('oct-dn').addEventListener('click', () => {
  if (currentOctave <= 2) return;
  currentOctave--;
  document.getElementById('oct-num').textContent = currentOctave;
  buildKeys();
});
document.getElementById('oct-up').addEventListener('click', () => {
  if (currentOctave >= 6) return;
  currentOctave++;
  document.getElementById('oct-num').textContent = currentOctave;
  buildKeys();
});

// ════════════════════════════════════════════
// 14. KNOB / SLIDER CONTROLS
// ════════════════════════════════════════════
function applyGain() {
  if (!masterGain) return;
  masterGain.gain.value = params.volume / 100;
}

function applyTone() {
  if (!toneFilter) return;
  // tone 0 = very warm (1200Hz), tone 100 = bright (12000Hz)
  toneFilter.frequency.value = 1200 + (params.tone / 100) * 10800;
}

function applyReverb() {
  if (!wetGain || !dryGain) return;
  const w = params.reverb / 100;
  wetGain.gain.value = reverbEnabled ? w * 0.9 : 0;
  dryGain.gain.value = 1.0;
}

function updateReverbTag(val) {
  const tag = document.getElementById('rev-tag');
  if (val < 15) tag.textContent = 'Dry';
  else if (val < 40) tag.textContent = 'Room';
  else if (val < 70) tag.textContent = 'Hall';
  else tag.textContent = 'Cathedral';
}

// Volume
const volSlider = document.getElementById('vol');
volSlider.addEventListener('input', () => {
  params.volume = +volSlider.value;
  document.getElementById('vol-num').textContent = params.volume;
  applyGain();
});

// Reverb amount
const revSlider = document.getElementById('rev');
revSlider.addEventListener('input', () => {
  params.reverb = +revSlider.value;
  document.getElementById('rev-num').textContent = params.reverb;
  updateReverbTag(params.reverb);
  applyReverb();
});

// Decay
const decSlider = document.getElementById('dec');
decSlider.addEventListener('input', () => {
  params.decay = +decSlider.value;
  document.getElementById('dec-num').textContent = params.decay;
  // Rebuild reverb IR to match new decay time
  if (ctx) buildReverb(params.decay / 25);
});

// Tone
const toneSlider = document.getElementById('tone');
toneSlider.addEventListener('input', () => {
  params.tone = +toneSlider.value;
  document.getElementById('tone-num').textContent = params.tone;
  applyTone();
});

// Reverb toggle button
function toggleReverb() {
  reverbEnabled = !reverbEnabled;
  const btn = document.getElementById('rev-toggle');
  btn.textContent = reverbEnabled ? 'ON' : 'OFF';
  btn.classList.toggle('on', reverbEnabled);
  applyReverb();
}
document.getElementById('rev-toggle').addEventListener('click', toggleReverb);

// ════════════════════════════════════════════
// 15. NOTE DISPLAY
// ════════════════════════════════════════════
function updateNoteDisplay(note) {
  const el = document.getElementById('note-big');
  el.textContent = note;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ════════════════════════════════════════════
// 16. CANVAS VISUALIZER
// ════════════════════════════════════════════
const cvs = document.getElementById('viz');
const c2d = cvs.getContext('2d');
const waves = [];

function addWave(freq) {
  waves.push({ freq, age: 0, max: 70, phase: Math.random() * Math.PI * 2 });
  if (waves.length > 10) waves.shift();
}

function drawViz() {
  requestAnimationFrame(drawViz);
  const W = cvs.width, H = cvs.height;
  c2d.clearRect(0, 0, W, H);
  c2d.fillStyle = '#0d0b18';
  c2d.fillRect(0, 0, W, H);

  const accent = currentInstrument === 'harmonium' ? '#48c8a8' : '#e8a030';

  if (!waves.length) {
    c2d.strokeStyle = 'rgba(255,255,255,0.05)';
    c2d.lineWidth = 1;
    c2d.beginPath(); c2d.moveTo(0, H/2); c2d.lineTo(W, H/2); c2d.stroke();
    return;
  }

  c2d.beginPath();
  c2d.lineWidth = 2;

  for (let x = 0; x <= W; x++) {
    let y = 0;
    waves.forEach(w => {
      const decay = 1 - w.age / w.max;
      const amp = decay * H * 0.38;
      const speed = (w.freq / 440) * 3.5;
      y += amp * Math.sin((x / W) * Math.PI * 2 * speed + w.phase);
    });

    if (x === 0) c2d.moveTo(x, H/2 + y);
    else c2d.lineTo(x, H/2 + y);
  }

  const grad = c2d.createLinearGradient(0,0,W,0);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(0.1, accent);
  grad.addColorStop(0.9, accent);
  grad.addColorStop(1, 'transparent');
  c2d.strokeStyle = grad;
  c2d.shadowColor = accent; c2d.shadowBlur = 12;
  c2d.stroke();
  c2d.shadowBlur = 0;

  for (let i = waves.length - 1; i >= 0; i--) {
    waves[i].age += 1;
    waves[i].phase += 0.07 + waves[i].freq / 8000;
    if (waves[i].age >= waves[i].max) waves.splice(i, 1);
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = cvs.parentElement.clientWidth - 10;
  cvs.width  = w * dpr;
  cvs.height = 80 * dpr;
  cvs.style.width  = w + 'px';
  cvs.style.height = '80px';
  c2d.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
drawViz();

// ════════════════════════════════════════════
// 17. INIT
// ════════════════════════════════════════════
buildKeys();
buildChords();

// Boot audio on first tap/click anywhere
document.body.addEventListener('pointerdown', () => { boot(); applyGain(); applyTone(); }, { once: true });

console.log('%c ♪ Music by Sun ♪ ', 'background:#e8a030;color:#07060d;font-size:16px;font-weight:bold;padding:5px 12px;border-radius:4px');
console.log('%c Keys: A S D F G H J K | R = Reverb toggle', 'color:#7a7090');
