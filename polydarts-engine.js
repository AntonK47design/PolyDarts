import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const ORDER = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
const R = 1.5, BY = 0.6;
const RB = { bull:.042, ob:.1, tIn:.57, tOut:.64, dIn:.93, dOut:1 };
const DEPTH = { bull:.14, obull:.11, triple:.09, double:.09, single:.05, miss:0, wall:-1.62 };

function scoreAt(x, y) {
  const r = Math.hypot(x, y) / R;
  if (r <= RB.bull) return { n:25, m:2, score:50, ring:'bull', label:'BULLSEYE' };
  if (r <= RB.ob) return { n:25, m:1, score:25, ring:'obull', label:'BULL' };
  if (r > RB.dOut) return { n:0, m:0, score:0, ring: r > 1.3 ? 'wall' : 'miss', label:'MISS' };
  const a = Math.atan2(y, x) * 180 / Math.PI;
  const cw = (((90 - a + 9) % 360) + 360) % 360;
  const n = ORDER[Math.floor(cw / 18) % 20];
  let m = 1, ring = 'single';
  if (r >= RB.tIn && r <= RB.tOut) { m = 3; ring = 'triple'; } else if (r >= RB.dIn) { m = 2; ring = 'double'; }
  return { n, m, score:n*m, ring, label:(m===3?'T':m===2?'D':'') + n };
}
const gauss = () => (Math.random()+Math.random()+Math.random()-1.5) / 1.5;

// Throw feel. All tuning lives here. Board radius R = 1.5; gauss() has sd ≈ 1/3, so a scatter of s lands within ~s/3.
const AIM = {
  wobIdle:.24, wobSteady:.08, wobMax:.42, wobOver:.3,     // reticle sway: while settling, in the green window, cap, growth/s once over-held
  settle:1.0, steadyLen:.5, steadyJitter:.15,             // s of stillness until green, green window length, ± random start per throw
  stillV:.15,                                             // drag speed (board units, smoothed) above which the settle timer restarts
  scatBase:.13, scatWob:.9, rushed:2.2, rushedPow:1.5,    // landing spread; rushed = extra spread for releasing before green
  dragWob:.08, dragScat:.05,                              // extra sway / spread from recent dragging
  fatigue:.25, fatigueDecay:2.5,                          // sway added per throw, decaying per s — punishes rapid fire
  cooldown:.5, blitzCooldown:.5, hotBonus:1.5,            // s between darts; Blitz time bonus for a hot-number hit
};

export function createGame(el, cb = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const cv = renderer.domElement;
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  el.appendChild(cv);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1c1530');
  scene.fog = new THREE.Fog('#1c1530', 13, 30);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 80);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x553366, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3); sun.position.set(4, 6, 8); scene.add(sun);
  const rim = new THREE.DirectionalLight(0xff6a8a, .9); rim.position.set(-6, -3, 4); scene.add(rim);
  const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color:c, flatShading:true, roughness:.78, metalness:.04 }, o));

  // faceted backdrop
  const wg = new THREE.PlaneGeometry(34, 26, 20, 15), wp = wg.attributes.position;
  for (let i = 0; i < wp.count; i++) { wp.setZ(i, (Math.random()-.5)*.8); wp.setX(i, wp.getX(i)+(Math.random()-.5)*.6); wp.setY(i, wp.getY(i)+(Math.random()-.5)*.6); }
  wg.computeVertexNormals();
  const wallMat = M('#2e2350');
  const wall = new THREE.Mesh(wg, wallMat); wall.position.set(0, BY, -2); scene.add(wall);

  const shapes = [], shapeMats = [0,1,2,3].map(() => M('#ffffff'));
  const sgeos = [new THREE.IcosahedronGeometry(1,0), new THREE.OctahedronGeometry(1,0), new THREE.TetrahedronGeometry(1,0), new THREE.DodecahedronGeometry(1,0)];
  for (let i = 0; i < 24; i++) {
    let x, y; do { x = (Math.random()-.5)*12; y = BY + (Math.random()-.5)*13; } while (Math.abs(x) < 2.5 && Math.abs(y-BY) < 2.5);
    const s = new THREE.Mesh(sgeos[i%4], shapeMats[i%4]);
    s.scale.setScalar(.14 + Math.random()*.42);
    s.position.set(x, y, -.5 - Math.random()*1.2);
    s.rotation.set(Math.random()*6, Math.random()*6, 0);
    s.userData = { y, sp:.2+Math.random()*.6, ph:Math.random()*6 };
    scene.add(s); shapes.push(s);
  }

  // board
  const board = new THREE.Group(); board.position.set(0, BY, 0); scene.add(board);
  const spin = new THREE.Group(); board.add(spin);
  const backMat = M('#17121f');
  const back = new THREE.Mesh(new THREE.CylinderGeometry(R*1.3, R*1.38, .3, 10, 1), backMat);
  back.rotation.x = Math.PI/2; back.position.z = -.15; spin.add(back);
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(R*1.3, .05, 3, 10), M('#ffc94a', { metalness:.3 }));
  outerRing.rotation.z = Math.PI/10; outerRing.position.z = .01; spin.add(outerRing);

  const segs = [];
  const seg = (r0, r1, a0, a1, depth, steps) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= steps; i++) { const a = a0+(a1-a0)*i/steps; i ? s.lineTo(Math.cos(a)*r1, Math.sin(a)*r1) : s.moveTo(Math.cos(a)*r1, Math.sin(a)*r1); }
    for (let i = steps; i >= 0; i--) { const a = a0+(a1-a0)*i/steps; s.lineTo(Math.cos(a)*r0, Math.sin(a)*r0); }
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled:false });
  };
  const gap = .012, rg = .006;
  ORDER.forEach((n, i) => {
    const c = (90 - i*18) * Math.PI/180, h = 9*Math.PI/180;
    const a0 = c-h+gap, a1 = c+h-gap, alt = i % 2;
    [[RB.ob, RB.tIn, 'single', 2], [RB.tIn, RB.tOut, 'triple', 3], [RB.tOut, RB.dIn, 'single', 3], [RB.dIn, RB.dOut, 'double', 3]].forEach(([r0, r1, type, st]) => {
      const mesh = new THREE.Mesh(seg(r0*R+rg, r1*R-rg, a0, a1, DEPTH[type], st), M('#fff'));
      spin.add(mesh); segs.push({ mesh, n, type, alt });
    });
  });
  { const s = new THREE.Shape(); for (let i = 0; i <= 10; i++) { const a = i/10*Math.PI*2; i ? s.lineTo(Math.cos(a)*RB.ob*R, Math.sin(a)*RB.ob*R) : s.moveTo(Math.cos(a)*RB.ob*R, Math.sin(a)*RB.ob*R); }
    const hole = new THREE.Path(); for (let i = 0; i <= 8; i++) { const a = -i/8*Math.PI*2; i ? hole.lineTo(Math.cos(a)*RB.bull*R*1.1, Math.sin(a)*RB.bull*R*1.1) : hole.moveTo(Math.cos(a)*RB.bull*R*1.1, Math.sin(a)*RB.bull*R*1.1); }
    s.holes.push(hole);
    const ob = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth:DEPTH.obull, bevelEnabled:false }), M('#fff')); spin.add(ob); segs.push({ mesh:ob, n:25, type:'obull' });
    const bl = new THREE.Mesh(new THREE.CylinderGeometry(RB.bull*R, RB.bull*R, DEPTH.bull, 8), M('#fff')); bl.rotation.x = Math.PI/2; bl.position.z = DEPTH.bull/2; spin.add(bl); segs.push({ mesh:bl, n:25, type:'bull' });
  }
  const labels = [];
  const drawNum = (ctx, n) => { ctx.clearRect(0,0,128,128); ctx.fillStyle = '#fff'; ctx.font = '700 80px "Chakra Petch", "Arial Black", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(n, 64, 70); };
  ORDER.forEach((n, i) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d'); drawNum(ctx, n);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), new THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false }));
    const a = (90 - i*18) * Math.PI/180; m.position.set(Math.cos(a)*R*1.15, Math.sin(a)*R*1.15, .03);
    spin.add(m); labels.push({ m, n, ctx, tex });
  });
  document.fonts && document.fonts.ready.then(() => labels.forEach(l => { drawNum(l.ctx, l.n); l.tex.needsUpdate = true; }));

  // darts
  let skin = { barrel:'#c9d1e3', flight:'#ff5a5f', tip:'#e8ecf5' };
  const cyl = (r1, r2, h, s) => { const g = new THREE.CylinderGeometry(r1, r2, h, s); g.rotateX(Math.PI/2); return g; };
  const G_TIP = new THREE.ConeGeometry(.03, .22, 5); G_TIP.rotateX(Math.PI/2);
  const G_BAR = cyl(.058, .046, .34, 6), G_GRIP = cyl(.064, .064, .05, 6), G_SH = cyl(.022, .022, .3, 5);
  const finShape = new THREE.Shape(); finShape.moveTo(0,0); finShape.lineTo(.2,.06); finShape.lineTo(.21,.28); finShape.lineTo(0,.31); finShape.lineTo(0,0);
  const G_FIN = new THREE.ShapeGeometry(finShape);
  function makeDart(sk = skin) {
    const g = new THREE.Group();
    const tipM = M(sk.tip, { metalness:.6, roughness:.3 }), barM = M(sk.barrel, { metalness:.55, roughness:.35 }), flM = M(sk.flight, { side:THREE.DoubleSide, roughness:.6 });
    const tip = new THREE.Mesh(G_TIP, tipM); tip.position.z = -.11; g.add(tip);
    const bar = new THREE.Mesh(G_BAR, barM); bar.position.z = -.39; g.add(bar);
    [-.3, -.4, -.5].forEach(z => { const r = new THREE.Mesh(G_GRIP, flM); r.position.z = z; r.scale.z = .5; g.add(r); });
    const sh = new THREE.Mesh(G_SH, tipM); sh.position.z = -.71; g.add(sh);
    for (let k = 0; k < 4; k++) { const fg = new THREE.Group(); const f = new THREE.Mesh(G_FIN, flM); f.rotation.x = -Math.PI/2; f.position.z = -.72; fg.add(f); fg.rotation.z = k*Math.PI/2 + Math.PI/4; g.add(fg); }
    g.scale.setScalar(.9);
    return g;
  }
  let held = makeDart(); scene.add(held); held.visible = false;
  let showcase = makeDart(); showcase.scale.setScalar(1.25); scene.add(showcase); showcase.visible = false;

  const reticle = new THREE.Group();
  const retMat = new THREE.MeshBasicMaterial({ color:'#ffffff', depthTest:false, transparent:true, opacity:.95 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(.1, .135, 6), retMat); ring.rotation.z = Math.PI/6;
  const dot = new THREE.Mesh(new THREE.CircleGeometry(.025, 6), retMat);
  [ring, dot].forEach(m => { m.renderOrder = 20; reticle.add(m); });
  reticle.visible = false; scene.add(reticle);

  // fx
  const parts = [], waves = [], tetra = new THREE.TetrahedronGeometry(.06, 0), matCache = {};
  const pmat = c => matCache[c] || (matCache[c] = M(c, { emissive:c, emissiveIntensity:.35 }));
  function burst(p, colors, count, power) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(tetra, pmat(colors[i % colors.length]));
      m.position.copy(p); m.position.z += .1;
      const a = Math.random()*Math.PI*2, s = power*(.5+Math.random());
      m.userData = { v:new THREE.Vector3(Math.cos(a)*s, Math.sin(a)*s+1.2, 1+Math.random()*2.5), life:.7+Math.random()*.4, max:1.1, r:new THREE.Vector3(Math.random()*9, Math.random()*9, 0) };
      m.scale.setScalar(.6+Math.random()*1.2); scene.add(m); parts.push(m);
    }
  }
  function wave(p, c) {
    const m = new THREE.Mesh(new THREE.RingGeometry(.15, .21, 6), new THREE.MeshBasicMaterial({ color:c, transparent:true, depthTest:false }));
    m.position.copy(p); m.position.z = .2; m.renderOrder = 15; m.userData.t = 0; scene.add(m); waves.push(m);
  }

  // sound
  let ac = null;
  function tone(f, d, type, vol, slide, delay = 0) {
    if (!opts.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f*slide), t0+d);
      g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0+.01); g.gain.exponentialRampToValueAtTime(.0001, t0+d);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0+d+.05);
    } catch (e) {}
  }
  const SFX = {
    click: () => tone(880, .06, 'square', .035, 1.2),
    tick: () => tone(1560, .05, 'sine', .05, 1),
    whoosh: () => tone(900, .18, 'sine', .05, .3),
    thunk: () => { tone(120, .14, 'triangle', .4, .5); tone(2400, .03, 'square', .03, .5); },
    double: () => { SFX.thunk(); tone(660, .12, 'triangle', .12, 1, .04); tone(990, .16, 'triangle', .1, 1, .1); },
    triple: () => { SFX.thunk(); [660, 880, 1320].forEach((f, i) => tone(f, .16, 'square', .055, 1, .04+i*.06)); },
    bull: () => { SFX.thunk(); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .24, 'triangle', .12, 1, .04+i*.06)); },
    miss: () => tone(170, .22, 'sawtooth', .05, .6),
    bust: () => { tone(300, .25, 'sawtooth', .08, .5); tone(200, .35, 'sawtooth', .08, .5, .15); },
    win: () => [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, .25, 'triangle', .12, 1, i*.09)),
    coin: () => { tone(1320, .08, 'square', .04, 1); tone(1760, .14, 'square', .04, 1, .06); },
    combo: n => tone(440*Math.pow(1.06, n*2), .12, 'square', .05, 1.5),
    ton: () => [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, .2, 'square', .06, 1, i*.07)),
  };

  // state
  let opts = { sound:true, difficulty:1 };
  let mode = 'menu', paused = false, t = 0, last = performance.now(), raf = 0, shake = 0, dist = 11;
  let G = null, holding = false, holdT = 0, dragV = 0, curA = .13, readyIn = 0, heldK = 0, lp = null, pid = null, emitKey = '';
  let steadyAt = AIM.settle, fat = 0, wobIn = 0, wasSteady = false;
  const wob = { x:0, y:0 }, wobTo = { x:0, y:0 };
  const aim = { x:0, y:0 }, aimP = new THREE.Vector2();
  const flying = [], stuck = [], timers = [];
  const later = (s, fn) => timers.push({ s, fn });
  const cam = { pos:new THREE.Vector3(0, BY, 14), look:new THREE.Vector3(0, BY, 0) };
  let hl = null, hlColor = '#3ddc97', theme = null;

  function setTheme(th) {
    theme = th;
    scene.background.set(th.bg); scene.fog.color.set(th.bg);
    wallMat.color.set(th.wall); backMat.color.set(th.backing);
    segs.forEach(s => {
      const c = s.type === 'single' ? (s.alt ? th.sA : th.sB) : s.type === 'bull' ? th.bull : s.type === 'obull' ? th.obull : (s.alt ? th.rA : th.rB);
      s.mesh.material.color.set(c);
    });
    shapeMats.forEach((m, i) => m.color.set(th.shapes[i % th.shapes.length]));
    labels.forEach(l => l.m.material.color.set(th.num));
  }
  function setSkin(sk) {
    skin = sk;
    const hv = held.visible; scene.remove(held); held = makeDart(sk); held.visible = hv; scene.add(held);
    scene.remove(showcase); showcase = makeDart(sk); showcase.scale.setScalar(1.25); showcase.visible = mode === 'shop'; scene.add(showcase);
  }

  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1;
    renderer.setSize(w, h, false); camera.aspect = w/h;
    const tan = Math.tan(camera.fov*Math.PI/360);
    dist = Math.max(R*1.22/(tan*camera.aspect), R*2.6/tan);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();

  function pose() {
    if (mode === 'play') return [new THREE.Vector3(0, BY-.55, dist), new THREE.Vector3(0, BY-.95, 0)];
    if (mode === 'shop') return [new THREE.Vector3(Math.sin(t*.3)*.5, BY-1.2, dist*1.05), new THREE.Vector3(0, BY-2.3, 0)];
    return [new THREE.Vector3(Math.sin(t*.22)*2.4, BY-.3+Math.sin(t*.31)*.4, dist*1.12), new THREE.Vector3(0, BY-.35, 0)];
  }

  function clearStuck(all = true) { stuck.forEach(s => s.dying = s.dying || (all ? .001 : 0)); }
  function placeMenuDarts() {
    stuck.forEach(s => s.g.parent && s.g.parent.remove(s.g)); stuck.length = 0;
    [[0, R*.605, -.2], [.03, -.02, .15], [R*.42, -R*.3, .1]].forEach(([x, y, tilt]) => {
      const res = scoreAt(x, y), g = makeDart();
      g.position.set(x, y, DEPTH[res.ring]-.03); spin.add(g);
      g.lookAt(new THREE.Vector3(x+tilt, y-.3, -2));
      stuck.push({ g, base:g.quaternion.clone(), wt:9, dying:0 });
    });
  }
  placeMenuDarts();

  // game rules
  function newG(m) {
    return { mode:m, darts:0, thrown:0, turn:[], round:1, remaining:301, turnStart:301, target:1, score:0, streak:0, mult:1,
      time: m === 'blitz' ? 45 : 0, elapsed:0, over:false, lock:false, hot:ORDER[Math.floor(Math.random()*20)], recent:[],
      stats:{ bulls:0, bullseyes:0, triples:0, doubles:0, misses:0, hits:0, bestTurn:0, tons:0, nums:{}, maxMult:1, hotHits:0, cleanTurns:0, dout:0 } };
  }
  function hud() {
    return { mode:G.mode, remaining:G.remaining, round:G.round, turn:G.mode === 'blitz' ? G.recent.slice(-3) : G.turn.slice(),
      thrown:G.thrown, target:G.target, darts:G.darts, time:G.time, score:G.score, streak:G.streak, mult:G.mult, hot:G.hot, over:G.over };
  }
  function emit(force) {
    if (!G) return;
    const k = [G.remaining, G.round, G.turn.length, G.thrown, G.target, G.darts, Math.floor(G.time*10), G.score, G.mult, G.hot, G.over].join('|');
    if (force || k !== emitKey) { emitKey = k; cb.onHud && cb.onHud(hud()); }
  }
  function stars() {
    if (G.mode === 'classic') return !G.won ? 0 : G.darts <= 12 ? 3 : G.darts <= 21 ? 2 : 1;
    if (G.mode === 'clock') return !G.won ? 0 : G.darts <= 26 ? 3 : G.darts <= 38 ? 2 : 1;
    return G.score >= 2100 ? 3 : G.score >= 1300 ? 2 : G.score >= 700 ? 1 : 0;
  }
  function finish(won) {
    if (G.over) return;
    G.over = true; G.won = won; holding = false; emit(true);
    if (won) SFX.win();
    later(won ? 1.5 : 1.0, () => cb.onEnd && cb.onEnd({ mode:G.mode, win:won, stars:stars(), darts:G.darts, round:G.round, remaining:G.remaining,
      target:G.target, time:G.time, score:G.score, stats:{ ...G.stats } }));
  }
  function endTurn() {
    const total = G.turn.reduce((a, b) => a + b.score, 0);
    if (!G.busted && G.turn.length === 3 && G.turn.every(x => x.score > 0)) G.stats.cleanTurns++;
    if (G.mode === 'classic' && !G.busted) {
      G.stats.bestTurn = Math.max(G.stats.bestTurn, total);
      if (total >= 100) { G.stats.tons++; SFX.ton(); }
      cb.onTurn && cb.onTurn(total);
    }
    G.lock = true;
    later(1.0, () => {
      if (G.over) return;
      clearStuck(); G.turn = []; G.thrown = 0; G.round++; G.turnStart = G.remaining; G.busted = false; G.lock = false;
      if (G.mode === 'classic' && G.round > 12) { G.round = 12; finish(false); }
      emit(true);
    });
  }
  function process(res, world, steady) {
    const st = G.stats; G.darts++;
    if (res.ring === 'bull') { st.bulls++; st.bullseyes++; } else if (res.ring === 'obull') st.bulls++;
    else if (res.ring === 'triple') st.triples++; else if (res.ring === 'double') st.doubles++;
    if (res.score > 0) { st.hits++; st.nums[res.n] = (st.nums[res.n] || 0) + 1; } else st.misses++;
    const v = world.clone().project(camera);
    const hit = { ...res, mode:G.mode, sx:(v.x+1)/2*el.clientWidth, sy:(1-v.y)/2*el.clientHeight, steady, pts:res.score, extra:'', good:res.score > 0 };
    if (G.mode === 'classic') {
      G.turn.push({ label:res.label, score:res.score });
      const nr = G.remaining - res.score;
      if (nr < 0) { G.busted = true; G.remaining = G.turnStart; SFX.bust(); cb.onBanner && cb.onBanner('BUST', 'Back to ' + G.turnStart, 'bad'); cb.onHit && cb.onHit(hit); endTurn(); emit(true); return; }
      G.remaining = nr; hit.extra = res.score ? '-' + res.score : '';
      cb.onHit && cb.onHit(hit);
      if (nr === 0) { st.dout = (res.m === 2 || res.ring === 'bull') ? 1 : 0; finish(true); cb.onBanner && cb.onBanner('CHECKOUT!', G.darts + ' darts', 'win'); }
      else if (G.turn.length === 3) endTurn();
    } else if (G.mode === 'clock') {
      G.turn.push({ label:res.label, score:res.score });
      if (res.n === G.target && res.score > 0) {
        if (G.target === 25) { hit.extra = 'CLOCK DONE'; cb.onHit && cb.onHit(hit); finish(true); cb.onBanner && cb.onBanner('FULL CLOCK!', G.darts + ' darts', 'win'); emit(true); return; }
        let nx = G.target + res.m; if (nx > 20) nx = 25; G.target = nx;
        hit.extra = res.m > 1 ? 'SKIP +' + res.m : 'NEXT ' + (nx === 25 ? 'BULL' : nx);
      } else { hit.good = false; hit.extra = res.score ? 'NEED ' + (G.target === 25 ? 'BULL' : G.target) : ''; }
      cb.onHit && cb.onHit(hit);
      if (G.turn.length === 3) endTurn();
    } else {
      const clean = steady || res.ring !== 'single' || res.n === G.hot;
      if (res.score > 0 && !clean) { hit.extra = G.streak >= 3 ? 'RUSHED · COMBO LOST' : 'RUSHED'; G.streak = 0; G.mult = 1; G.score += res.score; }
      else if (res.score > 0) {
        G.streak++; G.mult = Math.min(5, 1 + Math.floor(G.streak/3)); st.maxMult = Math.max(st.maxMult, G.mult);
        let pts = res.score * G.mult;
        if (res.n === G.hot) { st.hotHits++; pts *= 2; G.time += AIM.hotBonus; hit.extra = 'HOT ×2 · +' + AIM.hotBonus + 's'; let h; do { h = ORDER[Math.floor(Math.random()*20)]; } while (h === G.hot); G.hot = h; }
        else if (G.mult > 1) hit.extra = '×' + G.mult;
        if (G.streak % 3 === 0 && G.mult > 1) SFX.combo(G.mult);
        G.score += pts; hit.pts = pts;
      } else { if (G.streak >= 3) hit.extra = 'COMBO LOST'; G.streak = 0; G.mult = 1; }
      G.recent.push({ label:res.label, score:hit.pts });
      cb.onHit && cb.onHit(hit);
      const live = stuck.filter(s => !s.dying); if (live.length > 3) live[0].dying = .001;
    }
    emit(true);
  }

  function phase(h) { return h < steadyAt ? 'settle' : h < steadyAt + AIM.steadyLen ? 'steady' : 'over'; }
  function canThrow() { return mode === 'play' && !paused && G && !G.over && !G.lock && readyIn <= 0 && (G.mode === 'blitz' || G.thrown < 3); }
  function throwDart() {
    if (!canThrow()) return;
    const sc = curA * AIM.scatWob + AIM.scatBase + Math.pow(Math.max(0, 1 - holdT/steadyAt), AIM.rushedPow) * AIM.rushed * opts.difficulty + Math.min(.25, dragV * AIM.dragScat);
    const px = aimP.x + gauss()*sc, py = aimP.y + gauss()*sc;
    const pre = scoreAt(px, py);
    const g = makeDart(); g.position.copy(held.position); g.quaternion.copy(held.quaternion); scene.add(g);
    const steady = phase(holdT) === 'steady';
    flying.push({ g, from:held.position.clone(), to:new THREE.Vector3(px, BY+py, DEPTH[pre.ring]-.03), t:0, dur:.26 });
    flying[flying.length-1].steady = steady;
    G.thrown++; readyIn = G.mode === 'blitz' ? AIM.blitzCooldown : AIM.cooldown; heldK = 0; held.visible = false;
    fat += AIM.fatigue; steadyAt = AIM.settle + (Math.random()*2 - 1) * AIM.steadyJitter;
    SFX.whoosh(); emit(true);
  }
  function arrive(f) {
    const world = f.to.clone(), local = spin.worldToLocal(world.clone()), res = scoreAt(local.x, local.y);
    world.z = DEPTH[res.ring] - .03; f.g.position.copy(world);
    f.g.lookAt(new THREE.Vector3(world.x + (Math.random()-.5)*.5, world.y - .25 - Math.random()*.2, world.z - 2));
    if (res.ring !== 'wall') spin.attach(f.g);
    stuck.push({ g:f.g, base:f.g.quaternion.clone(), wt:0, dying:0, amp:res.ring === 'bull' ? .25 : .14 });
    const th = theme || { rA:'#ff5a5f', rB:'#3ddc97', sA:'#fff4e0', bull:'#ff5a5f' };
    const P = { bull:[['#ffc94a', th.bull, '#ffffff', '#ff5a5f'], 40, 3.2, .16], obull:[['#ffc94a', th.obull, '#ffffff'], 26, 2.4, .1],
      triple:[[th.rA, th.rB, '#ffc94a', '#ffffff'], 30, 2.6, .12], double:[[th.rA, th.rB, '#ffffff'], 20, 2, .08],
      single:[[th.sA, th.sB, skin.flight], 10, 1.4, .04], miss:[['#8a84a8', '#5d5780'], 6, 1, .03], wall:[['#8a84a8'], 5, .8, .02] }[res.ring];
    burst(world, P[0], P[1], P[2]); shake = Math.max(shake, P[3]);
    if (['bull', 'obull', 'triple', 'double'].includes(res.ring)) wave(world, P[0][0]);
    if (res.ring === 'bull') { wave(world, '#ffffff'); setTimeout(() => wave(world, '#ffc94a'), 120); }
    ({ bull:SFX.bull, obull:SFX.double, triple:SFX.triple, double:SFX.double, single:SFX.thunk, miss:SFX.miss, wall:SFX.miss })[res.ring]();
    if (G && mode === 'play') process(res, world, f.steady);
  }

  // input
  const onDown = e => { if (holding || !canThrow()) return; holding = true; holdT = 0; pid = e.pointerId; lp = { x:e.clientX, y:e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} cb.onAim && cb.onAim(); };
  const onMove = e => {
    if (!holding || e.pointerId !== pid) return;
    const s = 1.9*R / Math.max(320, el.clientWidth);
    aim.x += (e.clientX - lp.x)*s; aim.y -= (e.clientY - lp.y)*s; dragV += Math.hypot(e.clientX - lp.x, e.clientY - lp.y)*s*4; lp = { x:e.clientX, y:e.clientY };
    const l = Math.hypot(aim.x, aim.y), mx = R*1.35; if (l > mx) { aim.x *= mx/l; aim.y *= mx/l; }
  };
  const onUp = e => { if (!holding || e.pointerId !== pid) return; holding = false; throwDart(); };
  const onCancel = e => { if (e.pointerId === pid) holding = false; };
  const onBlur = () => { holding = false; };
  cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onBlur); document.addEventListener('visibilitychange', onBlur);

  function update(dt) {
    t += dt;
    const [tp, tl] = pose(), k = 1 - Math.exp(-dt*2.6);
    cam.pos.lerp(tp, k); cam.look.lerp(tl, k);
    camera.position.copy(cam.pos);
    if (shake > 0) { camera.position.x += (Math.random()-.5)*shake; camera.position.y += (Math.random()-.5)*shake; shake *= Math.exp(-dt*9); if (shake < .002) shake = 0; }
    camera.lookAt(cam.look);
    shapes.forEach(s => { s.rotation.x += dt*s.userData.sp*.5; s.rotation.y += dt*s.userData.sp*.4; s.position.y = s.userData.y + Math.sin(t*s.userData.sp + s.userData.ph)*.2; });
    if (mode !== 'play') spin.rotation.z += dt*.06;
    const live = !paused;
    if (live) for (let i = timers.length-1; i >= 0; i--) { timers[i].s -= dt; if (timers[i].s <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); } }
    const playing = mode === 'play' && !paused && G && !G.over;
    if (playing) {
      readyIn -= dt;
      if (G.mode === 'blitz') {
        G.time -= dt; G.elapsed += dt;
        if (G.elapsed > 10) spin.rotation.z += dt*Math.min(.9, (G.elapsed-10)*.028);
        if (G.time <= 0) { G.time = 0; finish(true); cb.onBanner && cb.onBanner('TIME!', G.score + ' pts', 'win'); }
      } else if (G.mode === 'clock') { G.time += dt; if (G.time >= 120) { G.time = 120; finish(false); cb.onBanner && cb.onBanner('TIME UP', 'Reached ' + (G.target === 25 ? 'BULL' : G.target), 'bad'); } }
      emit();
    }
    // aim
    if (playing) {
      if (holding) holdT = dragV > AIM.stillV ? 0 : holdT + dt;
      dragV *= Math.exp(-dt*6); fat *= Math.exp(-dt*AIM.fatigueDecay);
      const ph = phase(holdT), steadyNow = holding && ph === 'steady';
      if (steadyNow && !wasSteady) SFX.tick(); wasSteady = steadyNow;
      let A = !holding ? AIM.wobIdle : ph === 'settle' ? AIM.wobIdle - (AIM.wobIdle - AIM.wobSteady)*(holdT/steadyAt) : ph === 'steady' ? AIM.wobSteady : AIM.wobSteady + (holdT - steadyAt - AIM.steadyLen)*AIM.wobOver;
      A = Math.min(AIM.wobMax, A + Math.min(.2, dragV*AIM.dragWob) + fat);
      A *= opts.difficulty; curA += (A - curA)*Math.min(1, dt*8);
      // sway: smoothed random walk towards a new point in the unit disc every ~0.25–0.55 s (not a learnable loop)
      if ((wobIn -= dt) <= 0) { const a = Math.random()*Math.PI*2, r = Math.sqrt(Math.random())*1.3; wobTo.x = Math.cos(a)*r; wobTo.y = Math.sin(a)*r; wobIn = .25 + Math.random()*.3; }
      const wk = 1 - Math.exp(-dt*5); wob.x += (wobTo.x - wob.x)*wk; wob.y += (wobTo.y - wob.y)*wk;
      aimP.set(aim.x + curA*wob.x, aim.y + curA*wob.y - (holding ? Math.min(1, holdT*1.2)*.06 : 0));
      reticle.visible = readyIn <= 0 && (G.mode === 'blitz' || G.thrown < 3) && !G.lock;
      reticle.position.set(aimP.x, BY + aimP.y, .25); reticle.scale.setScalar((.75 + curA*5) * (steadyNow ? 1 + .1*Math.sin(t*16) : 1));
      retMat.color.set(steadyNow ? '#3ddc97' : holding && ph === 'over' ? '#ff5a5f' : '#ffffff');
      held.visible = reticle.visible;
      if (held.visible) {
        heldK = Math.min(1, heldK + dt*5);
        const pull = holding ? Math.min(1, holdT*2)*.3 : 0;
        held.position.set(aim.x*.16, cam.pos.y - .74 - (1-heldK)*1.2 - pull*.2, cam.pos.z - 3.4 + pull);
        held.lookAt(new THREE.Vector3(aimP.x, BY + aimP.y, 0));
      }
    } else { reticle.visible = false; held.visible = false; }
    if (mode === 'shop') { showcase.visible = true; showcase.position.set(0, cam.look.y + 1.25 + Math.sin(t*1.4)*.06, cam.pos.z - 4.2); showcase.rotation.set(.35, t*.9, .5); }
    else showcase.visible = false;
    // highlight
    const nh = mode === 'play' && G && !G.over ? (G.mode === 'clock' ? G.target : G.mode === 'blitz' ? G.hot : null) : null;
    if (nh !== hl) { hl = nh; hlColor = G && G.mode === 'blitz' ? '#ffc94a' : '#3ddc97'; segs.forEach(s => s.mesh.material.emissive.set(s.n === hl ? hlColor : '#000000')); }
    const pulse = .45 + .35*Math.sin(t*6);
    segs.forEach(s => { s.mesh.material.emissiveIntensity = s.n === hl ? pulse : 0; });
    labels.forEach(l => { const tg = l.n === hl ? 1.5 : 1; l.m.scale.setScalar(l.m.scale.x + (tg - l.m.scale.x)*Math.min(1, dt*8)); l.m.rotation.z = -spin.rotation.z; });
    if (!live) return;
    for (let i = flying.length-1; i >= 0; i--) {
      const f = flying[i]; f.t += dt/f.dur; const u = Math.min(1, f.t);
      const at = uu => new THREE.Vector3().lerpVectors(f.from, f.to, uu).add(new THREE.Vector3(0, Math.sin(Math.PI*uu)*.45, 0));
      f.g.position.copy(at(u)); if (u < .98) f.g.lookAt(at(Math.min(1, u + .04)));
      if (u >= 1) { flying.splice(i, 1); arrive(f); }
    }
    for (let i = stuck.length-1; i >= 0; i--) {
      const s = stuck[i]; s.wt += dt;
      if (s.wt < 1.2) { s.g.quaternion.copy(s.base); s.g.rotateX(Math.sin(s.wt*38)*(s.amp || .14)*Math.exp(-s.wt*5)); }
      if (s.dying) { s.dying += dt; const sc = Math.max(0, 1 - s.dying*4)*.9; s.g.scale.setScalar(sc); s.g.translateZ(-dt*3); if (sc <= 0) { s.g.parent && s.g.parent.remove(s.g); stuck.splice(i, 1); } }
    }
    for (let i = parts.length-1; i >= 0; i--) {
      const p = parts[i], d = p.userData; d.life -= dt; d.v.y -= 7*dt; p.position.addScaledVector(d.v, dt); p.rotation.x += d.r.x*dt; p.rotation.y += d.r.y*dt;
      p.scale.multiplyScalar(Math.pow(.2, dt)); if (d.life <= 0) { scene.remove(p); parts.splice(i, 1); }
    }
    for (let i = waves.length-1; i >= 0; i--) {
      const w = waves[i]; w.userData.t += dt; const u = w.userData.t/.55; w.scale.setScalar(1 + u*7); w.material.opacity = Math.max(0, 1-u);
      if (u >= 1) { scene.remove(w); w.geometry.dispose(); w.material.dispose(); waves.splice(i, 1); }
    }
  }
  function frame(now) { const dt = Math.min(.05, (now - last)/1000); last = now; update(dt); renderer.render(scene, camera); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  function reset() {
    flying.forEach(f => scene.remove(f.g)); flying.length = 0; timers.length = 0;
    stuck.forEach(s => s.g.parent && s.g.parent.remove(s.g)); stuck.length = 0;
  }
  return {
    start(m) { reset(); spin.rotation.z = 0; G = newG(m); mode = 'play'; paused = false; aim.x = 0; aim.y = 0; readyIn = .9; holding = false; fat = 0; steadyAt = AIM.settle; emit(true); },
    pause() { paused = true; holding = false; }, resume() { paused = false; },
    menu() { reset(); G = null; mode = 'menu'; paused = false; placeMenuDarts(); },
    shop(on) { if (mode === 'play') return; mode = on ? 'shop' : 'menu'; },
    setTheme, setSkin, setOptions(o) { Object.assign(opts, o); }, sfx(n, a) { SFX[n] && SFX[n](a); },
    destroy() { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('blur', onBlur); document.removeEventListener('visibilitychange', onBlur); renderer.dispose(); cv.remove(); },
  };
}
