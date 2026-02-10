// ============================================================
// ORBHOLD
// ============================================================

// --- CONSTANTS ---
const TILE_SIZE = 16;
let MAP_TILES = 64;
let MAP_PX = MAP_TILES * TILE_SIZE; // 1024
let MAP_CENTER = MAP_PX / 2;       // 512
let CIRCLE_RADIUS_TILES = 14;
let CIRCLE_RADIUS_PX = CIRCLE_RADIUS_TILES * TILE_SIZE; // 224

const CHAR_FRAME = 32;
const CHAR_COLS = 24;
const CHAR_ROWS = 8;
const SLIME_FRAME = 32;
const SLIME_COLS = 15;

const BASE_VIEW = 240; // reference view size for scale calculation
let pixelScale = 3;
let viewW = BASE_VIEW;
let viewH = BASE_VIEW;
let canvasW = 720;
let canvasH = 720;

const PLAYER_SPEED = 35;
const INITIAL_SLIMES = 30;
const SLIME_PICKUP_RADIUS = 6;
const PVP_TICK_INTERVAL = 0.50; // ~matches attack anim duration (4 frames @ 8fps)
const PVP_SLIME_DELAY = 1.0;
const ANIM_FPS = 8;

const RANGED_ATTACK_RANGE = 60;
const RANGED_COOLDOWN = 1.5;
const PROJECTILE_SPEED = 120;
const MAGIC_PROJECTILE_SPEED = 180;
const PROJECTILE_HIT_RADIUS = 6;

// Pre-computed squared thresholds for distance comparisons (avoid Math.sqrt)
const SLIME_PICKUP_RADIUS_SQ = (SLIME_PICKUP_RADIUS + 6) ** 2;
const RANGED_ATTACK_RANGE_SQ = RANGED_ATTACK_RANGE ** 2;
const PROJECTILE_HIT_RADIUS_SQ = PROJECTILE_HIT_RADIUS ** 2;

const CHARACTER_SHEETS = [
  'Human-Soldier-Red.png',
  'Orc-Grunt.png',
  'Orc-Peon-Cyan.png',
  'Orc-Peon-Red.png',
  'Orc-Soldier-Cyan.png',
  'Archer-Green.png',
  'Mage-Cyan.png',
  'Warrior-Blue.png',
  'Soldier-Yellow.png',
];
const PLAYER_NAMES = ['You', 'Grimjaw', 'Eldrin', 'Zephyra', 'Thorak', 'Nyx', 'Brokk', 'Sylva', 'Fenrik', 'Morrg'];

const ANIMS = {
  walk:  { cols: [0,1,2,3,4], loop: true },
  idle:  { cols: [0], loop: true },
  attack_sword:{ cols: [5,6,7,8], loop: false },
  attack_bow:{ cols: [9,10,11,12], loop: false },
  attack_wand:{ cols: [13,14,15,16], loop: false },
  hurt:  { cols: [20,21,22], loop: false },
  dying: { cols: [21,22,23], loop: false },
};

const SLIME_ANIMS = {
  idle:  { cols: [0,1,2,3,4,5], loop: true },
  dying: { cols: [10,11,12,13], loop: false },
};

// Direction: row index based on movement vector
// Rows: 0=S, 1=SW, 2=W, 3=NW, 4=N, 5=NE, 6=E, 7=SE
// Flat array indexed by (sx+1)*3 + (sy+1), where sx/sy are -1/0/1
const DIR_MAP = [
  /*(-1,-1)*/5, /*(-1,0)*/6, /*(-1,1)*/7,
  /*(0,-1)*/ 4, /*(0,0)*/ 0, /*(0,1)*/ 0,
  /*(1,-1)*/ 3, /*(1,0)*/ 2, /*(1,1)*/ 1,
];
function directionRow(dx, dy) {
  if (dx === 0 && dy === 0) return -1;
  const sx = dx > 0.01 ? 1 : dx < -0.01 ? -1 : 0;
  const sy = dy > 0.01 ? 1 : dy < -0.01 ? -1 : 0;
  return DIR_MAP[(sx + 1) * 3 + (sy + 1)];
}

// --- ASSET LOADER ---
const assets = {};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

async function loadAllAssets() {
  const env = ['Grass1.png', 'Grass2.png', 'Tree.png', 'Dirt.png'];
  const promises = [];

  for (const name of env) {
    promises.push(loadImage(`images/environment/${name}`).then(img => { assets[name] = img; }));
  }
  promises.push(loadImage('images/Slime.png').then(img => { assets['Slime.png'] = img; }));
  promises.push(loadImage('images/Bow_6.png').then(img => { assets['Bow_6.png'] = img; }));
  promises.push(loadImage('images/Magic_Wand_Water_2.png').then(img => { assets['Magic_Wand_Water_2.png'] = img; }));
  promises.push(loadImage('images/Greatsword_6.png').then(img => { assets['Greatsword_6.png'] = img; }));
  promises.push(loadImage('images/arrow.png').then(img => { assets['arrow.png'] = img; }));
  promises.push(loadImage('images/magic.png').then(img => { assets['magic.png'] = img; }));
  promises.push(loadImage('images/blood.png').then(img => { assets['blood.png'] = img; }));
  for (const name of CHARACTER_SHEETS) {
    promises.push(loadImage(`images/characters/${name}`).then(img => { assets[name] = img; }));
  }
  await Promise.all(promises);
}

// --- INPUT ---
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

let touchId = null;
let touchOrigin = null;
let touchDir = { dx: 0, dy: 0 };

function getInputDir() {
  let dx = 0, dy = 0;
  if (keys['KeyW'] || keys['ArrowUp']) dy = -1;
  if (keys['KeyS'] || keys['ArrowDown']) dy = 1;
  if (keys['KeyA'] || keys['ArrowLeft']) dx = -1;
  if (keys['KeyD'] || keys['ArrowRight']) dx = 1;
  if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
  if (touchId !== null) { dx = touchDir.dx; dy = touchDir.dy; }
  return { dx, dy };
}

// --- TILE MAP ---
// Each cell: { ground: 'Grass1.png'|'Grass2.png', tree: bool }
let tileMap = [];

function generateMap() {
  tileMap = [];
  for (let y = 0; y < MAP_TILES; y++) {
    const row = [];
    for (let x = 0; x < MAP_TILES; x++) {
      const cx = (x + 0.5) - MAP_TILES / 2;
      const cy = (y + 0.5) - MAP_TILES / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      // Checkerboard grass everywhere
      const grass = (x + y) % 2 === 0 ? 'Grass1.png' : 'Grass2.png';
      // Trees on the border ring and everywhere outside it
      const isTree = dist > CIRCLE_RADIUS_TILES - 1;
      row.push({ ground: grass, tree: isTree });
    }
    tileMap.push(row);
  }
}

function getTile(x, y) {
  // In-bounds: use the generated map
  if (x >= 0 && x < MAP_TILES && y >= 0 && y < MAP_TILES) return tileMap[y][x];
  // Out-of-bounds: checkerboard grass + trees
  return { ground: (x + y) % 2 === 0 ? 'Grass1.png' : 'Grass2.png', tree: true };
}

function isTreeAt(wx, wy) {
  const tx = Math.floor(wx / TILE_SIZE);
  const ty = Math.floor(wy / TILE_SIZE);
  return getTile(tx, ty).tree;
}

const MIN_MEMBER_DIST_SQ = 8 * 8; // enemy members stay at least 8px apart

function isBlockedByMember(wx, wy, ownPlayer) {
  for (const p of players) {
    if (!p.alive || p === ownPlayer) continue; // only block against enemies
    // Early exit: skip if player leader is far from the point
    const ldx = p.x - wx;
    const ldy = p.y - wy;
    const skipDist = p.formationRadius + 8; // formationRadius + MIN_MEMBER_DIST
    if (ldx * ldx + ldy * ldy > skipDist * skipDist) continue;
    for (const m of p.members) {
      const dx = m.x - wx;
      const dy = m.y - wy;
      if (dx * dx + dy * dy < MIN_MEMBER_DIST_SQ) return true;
    }
  }
  return false;
}

function renderMap(ctx, camX, camY) {
  const startX = Math.floor(camX / TILE_SIZE);
  const startY = Math.floor(camY / TILE_SIZE);
  const endX = Math.ceil((camX + viewW) / TILE_SIZE) + 1;
  const endY = Math.ceil((camY + viewH) / TILE_SIZE) + 1;

  // Floor camera offset so tiles land on whole pixels (prevents sub-pixel gaps)
  const cx = Math.floor(camX);
  const cy = Math.floor(camY);

  // Pass 1: draw ground tiles
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const cell = getTile(x, y);
      ctx.drawImage(assets[cell.ground], x * TILE_SIZE - cx, y * TILE_SIZE - cy, TILE_SIZE, TILE_SIZE);
    }
  }
  // Pass 2: draw tree overlays
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (getTile(x, y).tree) {
        ctx.drawImage(assets['Tree.png'], x * TILE_SIZE - cx, y * TILE_SIZE - cy, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

// --- SPRITE ANIMATOR ---
class SpriteAnimator {
  constructor(sheet, animDef, startOffset) {
    this.sheet = sheet;
    this.anim = animDef;
    this.frameIdx = 0;
    this.elapsed = startOffset || 0;
    this.finished = false;
    this.row = 0;
  }

  setAnim(animDef) {
    if (this.anim === animDef) return;
    this.anim = animDef;
    this.frameIdx = 0;
    this.elapsed = 0;
    this.finished = false;
  }

  update(dt) {
    if (this.finished) return;
    this.elapsed += dt;
    const frameDur = 1 / ANIM_FPS;
    while (this.elapsed >= frameDur) {
      this.elapsed -= frameDur;
      this.frameIdx++;
      if (this.frameIdx >= this.anim.cols.length) {
        if (this.anim.loop) {
          this.frameIdx = 0;
        } else {
          this.frameIdx = this.anim.cols.length - 1;
          this.finished = true;
        }
      }
    }
  }

  draw(ctx, x, y, row) {
    const col = this.anim.cols[this.frameIdx];
    const r = row !== undefined ? row : this.row;
    const isSlime = this.sheet === assets['Slime.png'];
    const frameW = isSlime ? SLIME_FRAME : CHAR_FRAME;
    const frameH = isSlime ? SLIME_FRAME : CHAR_FRAME;
    // Slimes: center on position. Characters: anchor at feet.
    const oy = isSlime ? y - frameH / 2 : y - frameH + 8;
    ctx.drawImage(
      this.sheet,
      col * frameW, r * frameH, frameW, frameH,
      x - frameW / 2, oy, frameW, frameH
    );
  }
}

// --- SLIME ENTITY ---
class Slime {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.alive = true;
    this.dead = false;
    this.animator = new SpriteAnimator(assets['Slime.png'], SLIME_ANIMS.idle, Math.random() * 0.5);
    this.radius = 8;
  }

  kill() {
    if (!this.alive) return;
    this.alive = false;
    this.animator.setAnim(SLIME_ANIMS.dying);
  }

  update(dt) {
    this.animator.update(dt);
    if (!this.alive && this.animator.finished) {
      this.dead = true;
    }
  }

  draw(ctx, camX, camY) {
    this.animator.draw(ctx, this.x - camX, this.y - camY, 0);
  }
}

// --- WEAPON DROP ENTITY ---
const WEAPON_SPRITES = {
  bow: 'Bow_6.png',
  wand: 'Magic_Wand_Water_2.png',
};

class WeaponDrop {
  constructor(x, y, type) {
    this.x = x;
    this.y = y;
    this.type = type; // 'bow' | 'wand'
    this.alive = true;
    this.bobTime = Math.random() * Math.PI * 2;
  }

  update(dt) {
    this.bobTime += dt * 3;
  }

  draw(ctx, camX, camY) {
    if (!this.alive) return;
    const bobY = Math.sin(this.bobTime) * 2;
    const img = assets[WEAPON_SPRITES[this.type]];
    ctx.drawImage(img, this.x - 8 - camX, this.y - 8 - camY + bobY, 16, 16);
  }
}

// --- PROJECTILE ENTITY ---
class Projectile {
  constructor(x, y, targetX, targetY, type, sourcePlayer, homingTarget) {
    this.x = x;
    this.y = y;
    this.type = type; // 'arrow' | 'magic'
    this.sourcePlayer = sourcePlayer;
    this.alive = true;
    this.homingTarget = homingTarget || null; // member ref for magic homing
    const speed = type === 'magic' ? MAGIC_PROJECTILE_SPEED : PROJECTILE_SPEED;
    this.speed = speed;
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? dx / dist : 1;
    const ny = dist > 0 ? dy / dist : 0;
    this.vx = nx * speed;
    this.vy = ny * speed;
    this.maxDist = dist + 16;
    this.traveled = 0;
  }

  update(dt) {
    if (!this.alive) return;
    // Magic projectiles home toward their target
    if (this.homingTarget) {
      const dx = this.homingTarget.x - this.x;
      const dy = this.homingTarget.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0) {
        this.vx = (dx / dist) * this.speed;
        this.vy = (dy / dist) * this.speed;
      }
    }
    const moveX = this.vx * dt;
    const moveY = this.vy * dt;
    this.x += moveX;
    this.y += moveY;
    this.traveled += Math.sqrt(moveX * moveX + moveY * moveY);
    if (this.traveled > this.maxDist) { this.alive = false; return; }

    for (const p of players) {
      if (!p.alive || p === this.sourcePlayer) continue;
      for (const m of p.members) {
        const dx = this.x - m.x;
        const dy = this.y - m.y;
        if (dx * dx + dy * dy < PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS) {
          const lost = p.loseCharacter(this.x, this.y);
          if (lost) scheduledSlimes.push({ x: lost.x, y: lost.y, timer: PVP_SLIME_DELAY });
          this.alive = false;
          return;
        }
      }
    }
  }

  draw(ctx, camX, camY) {
    if (!this.alive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;
    if (this.type === 'arrow') {
      const img = assets['arrow.png'];
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      ctx.restore();
    } else {
      const img = assets['magic.png'];
      ctx.drawImage(img, sx - img.width / 2, sy - img.height / 2);
    }
  }
}

// --- PLAYER ENTITY ---
const MEMBER_FOLLOW_SPEED = 120; // px/sec — members smoothly chase ideal position
const MEMBER_COMBAT_DIST = 16;   // member sprites must be this close to trigger PvP

class Player {
  constructor(x, y, sheetName, name, isHuman) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.isHuman = isHuman;
    this.sheet = assets[sheetName];
    this.charCount = 1;
    this.alive = true;
    this.dirRow = 0;
    this.moving = false;
    this.speed = PLAYER_SPEED;
    this.damageTimer = 0;     // >0 = attack winding up, damage dealt when it hits 0
    this.damageTarget = null; // the enemy player we're fighting

    // Each member has its own world position, animator, and combat state
    this.members = [{ x, y, combatTimer: 0, attackCooldown: 0, weapon: 'sword', animator: new SpriteAnimator(this.sheet, ANIMS.idle, 0) }];

    // Formation cache (separate counts to avoid stale cross-invalidation)
    this._cachedRadiusCount = -1;
    this._cachedRadius = 0;
    this._cachedOffsetsCount = -1;
    this._cachedOffsets = null;

    // AI state
    this.aiState = 'COLLECT';
    this.aiTimer = 0;
    this.jitterX = 0;
    this.jitterY = 0;
    this.jitterTimer = 0;
    this.targetSlime = null;
    this.targetPlayer = null;
    this.targetWeapon = null;
  }

  get formationRadius() {
    if (this.charCount === this._cachedRadiusCount) return this._cachedRadius;
    if (this.charCount <= 1) { this._cachedRadius = 0; this._cachedRadiusCount = this.charCount; return 0; }
    let totalPlaced = 1;
    let ring = 1;
    while (totalPlaced < this.charCount) {
      const circumference = 2 * Math.PI * ring * 12;
      const charsInRing = Math.max(1, Math.floor(circumference / 12));
      totalPlaced += charsInRing;
      ring++;
    }
    this._cachedRadius = (ring - 1) * 12;
    this._cachedRadiusCount = this.charCount;
    return this._cachedRadius;
  }

  _getFormationOffsets() {
    if (this._cachedOffsets && this._cachedOffsetsCount === this.charCount) return this._cachedOffsets;
    const offsets = [{ ox: 0, oy: 0 }];
    let placed = 1;
    let ring = 1;
    while (placed < this.charCount) {
      const ringRadius = ring * 12;
      const circumference = 2 * Math.PI * ringRadius;
      const charsInRing = Math.max(1, Math.floor(circumference / 12));
      for (let i = 0; i < charsInRing && placed < this.charCount; i++) {
        const angle = (2 * Math.PI * i) / charsInRing;
        offsets.push({
          ox: Math.cos(angle) * ringRadius,
          oy: Math.sin(angle) * ringRadius * 0.6,
        });
        placed++;
      }
      ring++;
    }
    this._cachedOffsets = offsets;
    this._cachedOffsetsCount = this.charCount;
    return offsets;
  }

  gainCharacter() {
    this.charCount++;
    this.members.push({
      x: this.x, y: this.y, combatTimer: 0, attackCooldown: 0, weapon: 'sword',
      animator: new SpriteAnimator(this.sheet, this.moving ? ANIMS.walk : ANIMS.idle, Math.random() * 0.4),
    });
  }

  loseCharacter(enemyX, enemyY) {
    if (this.charCount <= 0 || this.members.length === 0) return null;
    // Remove the member closest to the enemy
    let bestIdx = this.members.length - 1;
    if (enemyX !== undefined) {
      let bestDist = Infinity;
      for (let i = 0; i < this.members.length; i++) {
        const dx = this.members[i].x - enemyX;
        const dy = this.members[i].y - enemyY;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    const lost = this.members.splice(bestIdx, 1)[0];
    this.charCount--;
    if (this.charCount <= 0) this.alive = false;
    // Drop weapon if the dead member had a bow or wand
    if (lost.weapon !== 'sword') {
      weaponDrops.push(new WeaponDrop(lost.x, lost.y, lost.weapon));
    }
    return { x: lost.x, y: lost.y };
  }

  _isBlocked(x, y) {
    return isTreeAt(x, y) || isBlockedByMember(x, y, this);
  }

  update(dt) {
    if (!this.alive) return;

    // Pending damage countdown — deal damage when timer expires
    if (this.damageTimer > 0) {
      this.damageTimer -= dt;
      if (this.damageTimer <= 0) {
        const enemy = this.damageTarget;
        const ex = enemy ? enemy.x : undefined;
        const ey = enemy ? enemy.y : undefined;
        const lost = this.loseCharacter(ex, ey);
        if (lost) scheduledSlimes.push({ x: lost.x, y: lost.y, timer: PVP_SLIME_DELAY });
        this.damageTarget = null;
      }
    }

    const baseAnim = this.moving ? ANIMS.walk : ANIMS.idle;

    // Move each member toward its ideal formation position
    const offsets = this._getFormationOffsets();
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      m.combatTimer = Math.max(0, m.combatTimer - dt);
      m.attackCooldown = Math.max(0, m.attackCooldown - dt);

      const off = offsets[Math.min(i, offsets.length - 1)];
      const idealX = this.x + off.ox;
      const idealY = this.y + off.oy;
      const dx = idealX - m.x;
      const dy = idealY - m.y;
      const distSq = dx * dx + dy * dy;

      if (distSq > 0.25) {
        const dist = Math.sqrt(distSq);
        const step = Math.min(MEMBER_FOLLOW_SPEED * dt, dist);
        const nx = m.x + (dx / dist) * step;
        const ny = m.y + (dy / dist) * step;
        if (!this._isBlocked(nx, ny)) {
          m.x = nx; m.y = ny;
        } else if (!this._isBlocked(nx, m.y)) {
          m.x = nx;
        } else if (!this._isBlocked(m.x, ny)) {
          m.y = ny;
        }
      }

      // Per-member animation: pick attack anim based on weapon type
      const attackAnim = m.weapon === 'bow' ? ANIMS.attack_bow
                       : m.weapon === 'wand' ? ANIMS.attack_wand
                       : ANIMS.attack_sword;
      m.animator.setAnim(m.combatTimer > 0 ? attackAnim : baseAnim);
      m.animator.update(dt);
    }
  }

  move(dx, dy, dt) {
    if (!this.alive) return;
    this.moving = dx !== 0 || dy !== 0;
    if (!this.moving) return;

    const row = directionRow(dx, dy);
    if (row >= 0) this.dirRow = row;

    let nx = this.x + dx * this.speed * dt;
    let ny = this.y + dy * this.speed * dt;

    // Clamp to circle
    const fx = nx - MAP_CENTER;
    const fy = ny - MAP_CENTER;
    const dist = Math.sqrt(fx * fx + fy * fy);
    const maxR = CIRCLE_RADIUS_PX - 16;
    if (dist > maxR) {
      nx = MAP_CENTER + (fx / dist) * maxR;
      ny = MAP_CENTER + (fy / dist) * maxR;
    }

    // Tree collision on leader — slide along walls
    if (!isTreeAt(nx, this.y)) {
      this.x = nx;
    }
    if (!isTreeAt(this.x, ny)) {
      this.y = ny;
    }
  }

  draw(ctx, camX, camY) {
    if (!this.alive) return;

    // Sort members by Y for depth (reuse module-level array to avoid allocation)
    _sortedMembers.length = 0;
    for (const m of this.members) _sortedMembers.push(m);
    _sortedMembers.sort((a, b) => a.y - b.y);

    for (const m of _sortedMembers) {
      m.animator.draw(ctx, m.x - camX, m.y - camY, this.dirRow);
    }

    // Name label
    ctx.fillStyle = this.isHuman ? '#4f4' : '#fff';
    ctx.font = '5px "Press Start 2P", cursive';
    ctx.textAlign = 'center';
    const labelY = this.y - Math.max(this.formationRadius, 12) - 20 - camY;
    ctx.fillText(this.name, this.x - camX, labelY);

    // Weapon counts as mini icons (reuse module-level objects)
    _drawCounts.sword = 0; _drawCounts.bow = 0; _drawCounts.wand = 0;
    for (const m of this.members) _drawCounts[m.weapon]++;
    const iconSize = 5;
    _drawEntries.length = 0;
    for (const type of ['sword', 'bow', 'wand']) {
      if (_drawCounts[type] > 0) _drawEntries.push(type);
    }
    ctx.font = '4px "Press Start 2P", cursive';
    ctx.textAlign = 'left';
    // Measure total width: each entry = icon(5) + gap(1) + text + gap(2)
    const charW = 3; // approximate character width at 4px font
    let totalW = 0;
    for (const type of _drawEntries) {
      totalW += iconSize + 1 + String(_drawCounts[type]).length * charW + 2;
    }
    totalW -= 2; // no trailing gap
    let iconX = this.x - camX - totalW / 2;
    const iconY = labelY + 2;
    for (const type of _drawEntries) {
      ctx.drawImage(assets[ICON_ASSETS[type]], iconX, iconY, iconSize, iconSize);
      ctx.fillStyle = '#ff0';
      ctx.fillText(String(_drawCounts[type]), iconX + iconSize + 1, iconY + iconSize - 0.5);
      iconX += iconSize + 1 + String(_drawCounts[type]).length * charW + 2;
    }
    ctx.textAlign = 'center';
  }
}

// --- DRAW HELPERS (hoisted to module scope) ---
const ICON_ASSETS = { sword: 'Greatsword_6.png', bow: 'Bow_6.png', wand: 'Magic_Wand_Water_2.png' };
const _drawCounts = { sword: 0, bow: 0, wand: 0 };
const _drawEntries = [];
const _sortedMembers = []; // reusable array for Y-sorted drawing

// --- GAME STATE ---
let canvas, ctx;
let gameState = 'START'; // START, PLAYING, ENDED
let players = [];
let slimes = [];
let weaponDrops = [];
let projectiles = [];
let scheduledSlimes = [];
let winner = null;
let mapScale = 1; // area ratio vs 64-tile baseline

// DOM refs
let lbBody, startScreen, endScreen, winnerText, winnerDetail, newGameBtn;

// --- INIT ---
function resizeCanvas() {
  canvasW = window.innerWidth;
  canvasH = window.innerHeight;
  canvas.width = canvasW;
  canvas.height = canvasH;
  pixelScale = Math.max(2, Math.floor(Math.min(canvasW / BASE_VIEW, canvasH / BASE_VIEW)));
  viewW = canvasW / pixelScale;
  viewH = canvasH / pixelScale;
  // Resizing resets context state, so re-disable smoothing
  ctx.imageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
}

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d');

  lbBody = document.getElementById('lb-body');
  startScreen = document.getElementById('start-screen');
  endScreen = document.getElementById('end-screen');
  winnerText = document.getElementById('winner-text');
  winnerDetail = document.getElementById('winner-detail');
  newGameBtn = document.getElementById('new-game-btn');

  newGameBtn.addEventListener('click', () => {
    newGameBtn.classList.add('hidden');
    endScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    gameState = 'START';
  });

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Joystick listeners (touch)
  canvas.addEventListener('touchstart', e => {
    if (gameState !== 'PLAYING') return;
    e.preventDefault();
    const t = e.touches[0];
    touchId = t.identifier;
    touchOrigin = { x: t.clientX, y: t.clientY };
    touchDir = { dx: 0, dy: 0 };
  }, { passive: false });

  canvas.addEventListener('touchmove', e => {
    if (touchId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        e.preventDefault();
        const dx = t.clientX - touchOrigin.x;
        const dy = t.clientY - touchOrigin.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 10) {
          touchDir = { dx: dx / len, dy: dy / len };
        } else {
          touchDir = { dx: 0, dy: 0 };
        }
        break;
      }
    }
  }, { passive: false });

  canvas.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null;
        touchOrigin = null;
        touchDir = { dx: 0, dy: 0 };
        break;
      }
    }
  });

  canvas.addEventListener('touchcancel', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId) {
        touchId = null;
        touchOrigin = null;
        touchDir = { dx: 0, dy: 0 };
        break;
      }
    }
  });

  // Joystick listeners (mouse)
  canvas.addEventListener('mousedown', e => {
    if (gameState !== 'PLAYING') return;
    touchId = 'mouse';
    touchOrigin = { x: e.clientX, y: e.clientY };
    touchDir = { dx: 0, dy: 0 };
  });

  window.addEventListener('mousemove', e => {
    if (touchId !== 'mouse') return;
    const dx = e.clientX - touchOrigin.x;
    const dy = e.clientY - touchOrigin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 10) {
      touchDir = { dx: dx / len, dy: dy / len };
    } else {
      touchDir = { dx: 0, dy: 0 };
    }
  });

  window.addEventListener('mouseup', e => {
    if (touchId !== 'mouse') return;
    touchId = null;
    touchOrigin = null;
    touchDir = { dx: 0, dy: 0 };
  });

  // Option button toggling (prevent click from starting the game)
  for (const group of document.querySelectorAll('.option-buttons')) {
    group.addEventListener('click', e => {
      e.stopPropagation();
      const btn = e.target.closest('button');
      if (!btn) return;
      for (const b of group.querySelectorAll('button')) b.classList.remove('selected');
      btn.classList.add('selected');
    });
  }

  startScreen.addEventListener('click', startGame);
  endScreen.addEventListener('click', () => {
    endScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
  });

  loadAllAssets().then(() => {
    generateMap();
    requestAnimationFrame(gameLoop);
  });
}

function randomSpawnPos() {
  let tx, ty;
  do {
    tx = Math.floor(Math.random() * MAP_TILES);
    ty = Math.floor(Math.random() * MAP_TILES);
  } while (getTile(tx, ty).tree);
  // Center of the tile
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

function startGame() {
  // Read settings from option selectors
  const mapSizeBtn = document.querySelector('#map-size-options .selected');
  MAP_TILES = mapSizeBtn ? parseInt(mapSizeBtn.dataset.value) : 64;
  MAP_PX = MAP_TILES * TILE_SIZE;
  MAP_CENTER = MAP_PX / 2;
  CIRCLE_RADIUS_TILES = MAP_TILES / 2 - 2;
  CIRCLE_RADIUS_PX = CIRCLE_RADIUS_TILES * TILE_SIZE;
  mapScale = 2 * (MAP_TILES * MAP_TILES) / (64 * 64);

  const enemyCountBtn = document.querySelector('#enemy-count-options .selected');
  const enemyCount = enemyCountBtn ? parseInt(enemyCountBtn.dataset.value) : 7;

  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  newGameBtn.classList.add('hidden');
  gameState = 'PLAYING';
  winner = null;
  players = [];
  slimes = [];
  weaponDrops = [];
  projectiles = [];
  scheduledSlimes = [];
  generateMap();

  // Spawn players spread around the map
  // Shuffle bot sheets (indices 1+) so the player always gets sheet 0
  const botSheets = CHARACTER_SHEETS.slice(1);
  for (let i = botSheets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [botSheets[i], botSheets[j]] = [botSheets[j], botSheets[i]];
  }
  const totalPlayers = enemyCount + 1;
  for (let i = 0; i < totalPlayers; i++) {
    const angle = (Math.PI * 2 * i) / totalPlayers + (Math.random() - 0.5) * 0.3;
    const r = 80 + Math.random() * 80;
    const x = MAP_CENTER + Math.cos(angle) * r;
    const y = MAP_CENTER + Math.sin(angle) * r;
    const sheet = i === 0 ? CHARACTER_SHEETS[0] : botSheets[(i - 1) % botSheets.length];
    players.push(new Player(x, y, sheet, PLAYER_NAMES[i], i === 0));
  }

  // Spawn slimes (scaled by map area)
  const initialSlimes = Math.round(INITIAL_SLIMES * mapScale);
  for (let i = 0; i < initialSlimes; i++) {
    const pos = randomSpawnPos();
    slimes.push(new Slime(pos.x, pos.y));
  }

  // Spawn initial weapon drops (scaled by map area)
  const initialWeapons = Math.max(3, Math.round(5 * mapScale));
  for (let i = 0; i < initialWeapons; i++) {
    const pos = randomSpawnPos();
    const type = Math.random() < 0.5 ? 'bow' : 'wand';
    weaponDrops.push(new WeaponDrop(pos.x, pos.y, type));
  }
}

// --- AI ---
function updateAI(bot, dt) {
  if (!bot.alive) return;

  bot.aiTimer -= dt;
  bot.jitterTimer -= dt;

  if (bot.jitterTimer <= 0) {
    bot.jitterX = (Math.random() - 0.5) * 20;
    bot.jitterY = (Math.random() - 0.5) * 20;
    bot.jitterTimer = 1.5 + Math.random();
  }

  // Re-evaluate state
  if (bot.aiTimer <= 0) {
    bot.aiTimer = 0.4 + Math.random() * 0.2;
    bot.aiState = 'COLLECT';
    bot.targetSlime = null;
    bot.targetPlayer = null;

    const nearestThreat = findNearestPlayer(bot, p => p.alive && p !== bot && p.charCount > bot.charCount * 1.3);
    const nearestPrey = findNearestPlayer(bot, p => p.alive && p !== bot && p.charCount < bot.charCount * 0.8 && p.charCount > 0);

    if (nearestThreat && distBetweenSq(bot, nearestThreat) < 80 * 80) {
      bot.aiState = 'FLEE';
      bot.targetPlayer = nearestThreat;
    } else if (bot.charCount > 3 && nearestPrey && distBetweenSq(bot, nearestPrey) < 120 * 120) {
      bot.aiState = 'ATTACK';
      bot.targetPlayer = nearestPrey;
    } else {
      bot.aiState = 'COLLECT';
      bot.targetSlime = findNearestSlime(bot);
      // Also consider weapon drops as collection targets
      bot.targetWeapon = findNearestWeaponDrop(bot);
    }
  }

  let dx = 0, dy = 0;

  if (bot.aiState === 'FLEE' && bot.targetPlayer && bot.targetPlayer.alive) {
    const tx = bot.targetPlayer.x;
    const ty = bot.targetPlayer.y;
    dx = bot.x - tx;
    dy = bot.y - ty;
  } else if (bot.aiState === 'ATTACK' && bot.targetPlayer && bot.targetPlayer.alive) {
    dx = bot.targetPlayer.x - bot.x + bot.jitterX;
    dy = bot.targetPlayer.y - bot.y + bot.jitterY;
  } else {
    // COLLECT — go for nearest between slime and weapon drop
    if (!bot.targetSlime || !bot.targetSlime.alive) {
      bot.targetSlime = findNearestSlime(bot);
    }
    if (!bot.targetWeapon || !bot.targetWeapon.alive) {
      bot.targetWeapon = findNearestWeaponDrop(bot);
    }
    let target = bot.targetSlime;
    if (bot.targetWeapon && (!target || distBetweenSq(bot, bot.targetWeapon) < distBetweenSq(bot, target))) {
      target = bot.targetWeapon;
    }
    if (target) {
      dx = target.x - bot.x + bot.jitterX;
      dy = target.y - bot.y + bot.jitterY;
    }
  }

  const len = Math.sqrt(dx * dx + dy * dy);
  if (len > 1) {
    dx /= len;
    dy /= len;
  }
  bot.move(dx, dy, dt);
}

function findNearestSlime(player) {
  let best = null, bestDist = Infinity;
  for (const s of slimes) {
    if (!s.alive) continue;
    const d = distBetweenSq(player, s);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}

function findNearestWeaponDrop(player) {
  let best = null, bestDist = Infinity;
  for (const w of weaponDrops) {
    if (!w.alive) continue;
    const d = distBetweenSq(player, w);
    if (d < bestDist) { bestDist = d; best = w; }
  }
  return best;
}

function findNearestPlayer(player, filter) {
  let best = null, bestDist = Infinity;
  for (const p of players) {
    if (!filter(p)) continue;
    const d = distBetweenSq(player, p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

function distBetween(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distBetweenSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

// --- COLLISION ---
function nearestMemberDistSq(a, b) {
  let best = Infinity;
  for (const ma of a.members) {
    for (const mb of b.members) {
      const dx = ma.x - mb.x;
      const dy = ma.y - mb.y;
      const dsq = dx * dx + dy * dy;
      if (dsq < best) best = dsq;
    }
  }
  return best;
}

function checkCollisions(dt) {
  // Player vs Slime — any member can pick up
  for (const player of players) {
    if (!player.alive) continue;
    for (const slime of slimes) {
      if (!slime.alive) continue;
      for (const m of player.members) {
        const dx = m.x - slime.x;
        const dy = m.y - slime.y;
        if (dx * dx + dy * dy < SLIME_PICKUP_RADIUS_SQ) {
          slime.kill();
          player.gainCharacter();
          break;
        }
      }
    }
  }

  // Player vs WeaponDrop — any member can pick up
  // Iterate a snapshot so newly-created drops aren't visited this frame
  const pendingDrops = [];
  const dropCount = weaponDrops.length;
  for (const player of players) {
    if (!player.alive) continue;
    for (let di = 0; di < dropCount; di++) {
      const drop = weaponDrops[di];
      if (!drop.alive) continue;
      for (const m of player.members) {
        const dx = m.x - drop.x;
        const dy = m.y - drop.y;
        if (dx * dx + dy * dy < SLIME_PICKUP_RADIUS_SQ) {
          drop.alive = false;
          // Find a random sword-wielding member to equip
          const swordMembers = player.members.filter(mem => mem.weapon === 'sword');
          if (swordMembers.length > 0) {
            swordMembers[Math.floor(Math.random() * swordMembers.length)].weapon = drop.type;
          } else {
            // All members have special weapons — replace a random one, re-drop the old weapon
            const target = player.members[Math.floor(Math.random() * player.members.length)];
            pendingDrops.push(new WeaponDrop(drop.x, drop.y, target.weapon));
            target.weapon = drop.type;
          }
          break;
        }
      }
    }
  }
  // Add re-dropped weapons after iteration so they can't cause an infinite pickup loop
  for (const d of pendingDrops) weaponDrops.push(d);

  // Ranged attacks — bow/wand members fire projectiles at nearby enemies
  for (const player of players) {
    if (!player.alive) continue;
    for (const m of player.members) {
      if (m.weapon === 'sword' || m.attackCooldown > 0) continue;
      // Find nearest enemy member within range
      let bestTarget = null;
      let bestDist = RANGED_ATTACK_RANGE_SQ;
      for (const enemy of players) {
        if (!enemy.alive || enemy === player) continue;
        for (const em of enemy.members) {
          const dx = m.x - em.x;
          const dy = m.y - em.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; bestTarget = em; }
        }
      }
      if (bestTarget) {
        const projType = m.weapon === 'bow' ? 'arrow' : 'magic';
        const homingRef = projType === 'magic' ? bestTarget : null;
        projectiles.push(new Projectile(m.x, m.y, bestTarget.x, bestTarget.y, projType, player, homingRef));
        m.attackCooldown = RANGED_COOLDOWN;
        m.combatTimer = PVP_TICK_INTERVAL;
      }
    }
  }

  // Player vs Player — attack anim plays first, damage dealt after timer
  const combatThreshSq = MEMBER_COMBAT_DIST * MEMBER_COMBAT_DIST;
  const animThreshSq = combatThreshSq * 2;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a.alive || !b.alive) continue;
      if (a.damageTimer > 0 || b.damageTimer > 0) continue;

      // Single pass: find closest pair and mark nearby members for combat animation
      let bestDist = Infinity;
      for (const ma of a.members) {
        for (const mb of b.members) {
          const dx = ma.x - mb.x;
          const dy = ma.y - mb.y;
          const dsq = dx * dx + dy * dy;
          if (dsq < bestDist) bestDist = dsq;
          if (dsq < animThreshSq) {
            ma.combatTimer = PVP_TICK_INTERVAL;
            mb.combatTimer = PVP_TICK_INTERVAL;
          }
        }
      }

      if (bestDist < combatThreshSq) {
        a.damageTimer = PVP_TICK_INTERVAL;
        a.damageTarget = b;
        b.damageTimer = PVP_TICK_INTERVAL;
        b.damageTarget = a;
        a.dirRow = directionRow(b.x - a.x, b.y - a.y);
        b.dirRow = directionRow(a.x - b.x, a.y - b.y);
      }
    }
  }
}

// --- SLIME SPAWNING ---
function updateScheduledSlimes(dt) {
  for (let i = scheduledSlimes.length - 1; i >= 0; i--) {
    scheduledSlimes[i].timer -= dt;
    if (scheduledSlimes[i].timer <= 0) {
      const s = scheduledSlimes[i];
      slimes.push(new Slime(s.x, s.y));
      scheduledSlimes.splice(i, 1);
    }
  }

  // Periodic slime spawning to keep the game interesting (scaled by map area)
  if (Math.random() < dt * 0.5 * mapScale) {
    let aliveCount = 0;
    for (let i = 0; i < slimes.length; i++) if (slimes[i].alive) aliveCount++;
    if (aliveCount < 40 * mapScale) {
      const pos = randomSpawnPos();
      slimes.push(new Slime(pos.x, pos.y));
    }
  }

  // Periodic weapon drop spawning (scaled by map area)
  if (Math.random() < dt * 0.15 * mapScale) {
    let aliveCount = 0;
    for (let i = 0; i < weaponDrops.length; i++) if (weaponDrops[i].alive) aliveCount++;
    if (aliveCount < 8 * mapScale) {
      const pos = randomSpawnPos();
      const type = Math.random() < 0.5 ? 'bow' : 'wand';
      weaponDrops.push(new WeaponDrop(pos.x, pos.y, type));
    }
  }
}

// --- HUD ---
function updateHUD() {
  const sorted = [...players].sort((a, b) => b.charCount - a.charCount);
  let html = '';
  sorted.forEach((p, i) => {
    const cls = p.isHuman ? ' class="highlight"' : '';
    const status = p.alive ? p.charCount : '\u2620';
    html += `<tr${cls}><td>${i + 1}</td><td>${p.name}</td><td>${status}</td></tr>`;
  });
  lbBody.innerHTML = html;

  // Show "New Game" button when human player dies
  const human = players[0];
  if (human && !human.alive) {
    newGameBtn.classList.remove('hidden');
  }
}

// --- WIN CHECK ---
function checkWinCondition() {
  const alivePlayers = players.filter(p => p.alive);

  if (alivePlayers.length <= 1) {
    gameState = 'ENDED';
    winner = alivePlayers[0] || players[0];
  }

  if (gameState === 'ENDED') {
    endScreen.classList.remove('hidden');
    if (winner.isHuman) {
      winnerText.textContent = 'You Win!';
      winnerText.className = 'victory-text';
    } else {
      winnerText.textContent = `${winner.name} Wins!`;
      winnerText.className = 'defeat-text';
    }
    winnerDetail.textContent = `Army size: ${winner.charCount}`;
  }
}

// --- GAME LOOP ---
let lastTime = 0;
let frameCounter = 0;
const drawables = [];

function gameLoop(timestamp) {
  try {
  if (lastTime === 0) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  if (gameState === 'PLAYING') {
    // Human player input
    const human = players[0];
    if (human && human.alive) {
      const input = getInputDir();
      human.move(input.dx, input.dy, dt);
    }

    // AI bots
    for (let i = 1; i < players.length; i++) {
      updateAI(players[i], dt);
    }

    // Update all players
    for (const p of players) p.update(dt);

    // Update slimes
    for (const s of slimes) s.update(dt);

    // Update weapon drops
    for (const w of weaponDrops) w.update(dt);

    // Update projectiles
    for (const p of projectiles) p.update(dt);

    // Collisions
    checkCollisions(dt);
    updateScheduledSlimes(dt);

    // Cleanup dead entities in-place (swap-remove, iterate backward)
    for (let i = slimes.length - 1; i >= 0; i--) {
      if (slimes[i].dead) { slimes[i] = slimes[slimes.length - 1]; slimes.pop(); }
    }
    for (let i = weaponDrops.length - 1; i >= 0; i--) {
      if (!weaponDrops[i].alive) { weaponDrops[i] = weaponDrops[weaponDrops.length - 1]; weaponDrops.pop(); }
    }
    for (let i = projectiles.length - 1; i >= 0; i--) {
      if (!projectiles[i].alive) { projectiles[i] = projectiles[projectiles.length - 1]; projectiles.pop(); }
    }

    // Win check + HUD (throttled to every 10 frames)
    frameCounter++;
    if (frameCounter >= 10) {
      frameCounter = 0;
      checkWinCondition();
      updateHUD();
    }
  }

  // --- RENDER ---
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.save();
  ctx.scale(pixelScale, pixelScale);

  if (gameState === 'PLAYING' || gameState === 'ENDED') {
    // Camera centered on human player
    const human = players[0];
    const camX = human.x - viewW / 2;
    const camY = human.y - viewH / 2;

    // Draw map
    renderMap(ctx, camX, camY);

    // Draw blood splats on the ground (under entities, until slime spawns)
    const bloodImg = assets['blood.png'];
    for (const s of scheduledSlimes) {
      ctx.drawImage(bloodImg, s.x - 8 - camX, s.y - 8 - camY, 16, 16);
    }

    // Collect all drawable entities and Y-sort (reuse module-level array)
    drawables.length = 0;
    for (const s of slimes) {
      drawables.push(s);
    }
    for (const w of weaponDrops) {
      if (w.alive) drawables.push(w);
    }
    for (const p of projectiles) {
      if (p.alive) drawables.push(p);
    }
    for (const p of players) {
      if (p.alive) drawables.push(p);
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw(ctx, camX, camY);
  }

  ctx.restore();

  // --- MINIMAP ---
  if (gameState === 'PLAYING' || gameState === 'ENDED') {
    const mmSize = 130;
    const mmMargin = 10;
    const mmBorder = 3;
    const mmX = mmMargin + mmBorder;
    const mmY = mmMargin + mmBorder;
    const scale = mmSize / MAP_PX;

    // Outer border frame
    ctx.save();
    ctx.fillStyle = '#2a2a3e';
    ctx.fillRect(mmMargin, mmMargin, mmSize + mmBorder * 2, mmSize + mmBorder * 2);

    // Top accent line
    ctx.fillStyle = '#6a5acd';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(mmMargin, mmMargin, mmSize + mmBorder * 2, 1);
    ctx.globalAlpha = 1;

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(mmX, mmY, mmSize, mmSize);
    ctx.globalAlpha = 1;

    // Clip to minimap bounds
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Arena circle outline
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mmX + MAP_CENTER * scale, mmY + MAP_CENTER * scale, CIRCLE_RADIUS_PX * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Slimes
    ctx.fillStyle = '#3a7a4a';
    for (const s of slimes) {
      if (!s.alive) continue;
      ctx.fillRect(mmX + s.x * scale - 0.5, mmY + s.y * scale - 0.5, 1.5, 1.5);
    }

    // Players (dot size scales with army size)
    for (const p of players) {
      if (!p.alive) continue;
      ctx.fillStyle = p.isHuman ? '#7dffb3' : '#ff5555';
      const dotSize = 2 + Math.min(p.charCount, 20) * 0.3;
      ctx.fillRect(mmX + p.x * scale - dotSize / 2, mmY + p.y * scale - dotSize / 2, dotSize, dotSize);
    }

    // Viewport rectangle
    const human = players[0];
    const camX = human.x - viewW / 2;
    const camY = human.y - viewH / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX + camX * scale, mmY + camY * scale, viewW * scale, viewH * scale);

    ctx.restore();
  }

  // --- VIRTUAL JOYSTICK ---
  if (touchId !== null && gameState === 'PLAYING') {
    const ox = touchOrigin.x, oy = touchOrigin.y;
    // Base circle
    ctx.beginPath();
    ctx.arc(ox, oy, 40, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Thumb dot
    ctx.beginPath();
    ctx.arc(ox + touchDir.dx * 30, oy + touchDir.dy * 30, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  }

  } catch (e) {
    console.error('Game loop error:', e);
  }
  requestAnimationFrame(gameLoop);
}

// --- START ---
window.addEventListener('DOMContentLoaded', init);
