(() => {
  const CHIP_VALUES = [1, 5, 10, 25, 100, 500, 1000, 5000, "max"];
  const DEFAULTS = {
    bankroll: 10000,
    numDecks: 6,
    penetration: 0.75,
    insurance: true,
    das: true,
    surrender: true,
    sound: true,
    music: true,
    musicVolume: 0.22,
    sfxVolume: 0.5,
    developerMode: false,
    rigMode: "normal"
  };

  const SUITS = ["S", "H", "D", "C"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const SUIT_SYMBOLS = {
    S: "&spades;",
    H: "&hearts;",
    D: "&diams;",
    C: "&clubs;"
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class Shoe {
    constructor(numDecks = 6) {
      this.numDecks = numDecks;
      this.cards = [];
      this.discard = [];
      this.build();
      this.shuffle();
    }

    build() {
      this.cards = [];
      for (let d = 0; d < this.numDecks; d += 1) {
        for (const suit of SUITS) {
          for (const rank of RANKS) {
            this.cards.push({ suit, rank });
          }
        }
      }
    }

    shuffle() {
      for (let i = this.cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
      }
    }

    needsShuffle(penetration = 0.75) {
      const used = this.discard.length;
      const total = this.numDecks * 52;
      return used / total >= penetration || this.cards.length < 20;
    }

    draw() {
      if (this.cards.length === 0) {
        this.cards = this.discard;
        this.discard = [];
        this.shuffle();
      }
      const card = this.cards.pop();
      return card;
    }

    discardHand(hand) {
      this.discard.push(...hand.cards);
    }
  }

  class Hand {
    constructor(bet = 0, isDealer = false) {
      this.bet = bet;
      this.cards = [];
      this.isDealer = isDealer;
      this.doubled = false;
      this.surrendered = false;
      this.isSplitAces = false;
      this.insuranceBet = 0;
      this.complete = false;
    }

    addCard(card) {
      this.cards.push(card);
    }

    getTotals() {
      let total = 0;
      let aces = 0;
      for (const card of this.cards) {
        if (card.rank === "A") {
          aces += 1;
          total += 11;
        } else if (["K", "Q", "J"].includes(card.rank)) {
          total += 10;
        } else {
          total += Number(card.rank);
        }
      }
      while (total > 21 && aces > 0) {
        total -= 10;
        aces -= 1;
      }
      const soft = aces > 0;
      return { total, soft };
    }

    isBlackjack() {
      return this.cards.length === 2 && this.getTotals().total === 21 && !this.surrendered;
    }

    isBust() {
      return this.getTotals().total > 21;
    }

    canSplit() {
      if (this.cards.length !== 2) return false;
      return this.cards[0].rank === this.cards[1].rank;
    }
  }

  class AudioManager {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;
      this.sfxGain = null;
      this.musicInterval = null;
      this.enabled = true;
      this.musicEnabled = true;
      this.musicVolume = DEFAULTS.musicVolume;
      this.sfxVolume = DEFAULTS.sfxVolume;
    }

    init() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.setMusicVolume(this.musicVolume);
      this.setSfxVolume(this.sfxVolume);
    }

    setEnabled(enabled) {
      this.enabled = enabled;
    }

    setMusicEnabled(enabled) {
      this.musicEnabled = enabled;
      if (!enabled) {
        this.stopMusic();
      } else {
        this.startMusic();
      }
    }

    setMusicVolume(value) {
      this.musicVolume = value;
      if (this.musicGain) this.musicGain.gain.value = value;
    }

    setSfxVolume(value) {
      this.sfxVolume = value;
      if (this.sfxGain) this.sfxGain.gain.value = value;
    }


    playTone(freq, duration, type = "sine", gainNode = this.sfxGain, timeOffset = 0) {
      if (!this.ctx) return;
      if (gainNode === this.musicGain && !this.musicEnabled) return;
      if (gainNode !== this.musicGain && !this.enabled) return;
      const now = this.ctx.currentTime + timeOffset;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0, now);
      const peak = gainNode === this.musicGain ? 0.18 : 0.4;
      gain.gain.linearRampToValueAtTime(peak, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(gainNode);
      osc.start(now);
      osc.stop(now + duration);
    }

    playWin() {
      this.playTone(523.25, 0.3, "triangle");
      this.playTone(659.25, 0.3, "triangle", this.sfxGain, 0.08);
      this.playTone(783.99, 0.3, "triangle", this.sfxGain, 0.16);
    }

    playBlackjack() {
      this.playTone(440, 0.35, "sawtooth");
      this.playTone(554.37, 0.35, "sawtooth", this.sfxGain, 0.06);
      this.playTone(659.25, 0.35, "sawtooth", this.sfxGain, 0.12);
      this.playTone(880, 0.4, "sine", this.sfxGain, 0.2);
    }

    playBust() {
      if (!this.ctx || !this.enabled) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.4);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.5);

      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(300, now + 0.18);
      osc2.frequency.exponentialRampToValueAtTime(80, now + 0.6);
      gain2.gain.setValueAtTime(0.25, now + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc2.connect(gain2);
      gain2.connect(this.sfxGain);
      osc2.start(now + 0.18);
      osc2.stop(now + 0.7);
    }

    playSwish() {
      if (!this.ctx || !this.enabled) return;
      const now = this.ctx.currentTime;
      const length = Math.floor(this.ctx.sampleRate * 0.28);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;
      const band = this.ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(900, now);
      band.frequency.exponentialRampToValueAtTime(1600, now + 0.2);
      const low = this.ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.setValueAtTime(5000, now);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      noise.connect(band);
      band.connect(low);
      low.connect(gain);
      gain.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.28);
    }

    playPop() {
      if (!this.ctx || !this.enabled) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.12);
    }

    startMusic() {
      if (!this.ctx || !this.musicEnabled) return;
      if (this.musicInterval) return;
      const chords = [
        [261.63, 329.63, 392.0, 493.88],
        [293.66, 369.99, 440.0, 554.37],
        [329.63, 415.3, 493.88, 622.25],
        [246.94, 311.13, 392.0, 466.16]
      ];
      let step = 0;
      this.musicInterval = setInterval(() => {
        if (!this.ctx || !this.musicEnabled) return;
        const chord = chords[step % chords.length];
        this.playTone(chord[0], 1.6, "sine", this.musicGain, 0);
        this.playTone(chord[1], 1.4, "triangle", this.musicGain, 0.1);
        this.playTone(chord[2], 1.2, "sine", this.musicGain, 0.2);
        this.playTone(chord[3], 1.0, "triangle", this.musicGain, 0.3);
        step += 1;
      }, 1400);
    }

    stopMusic() {
      if (this.musicInterval) {
        clearInterval(this.musicInterval);
        this.musicInterval = null;
      }
    }
  }

  /*
    LegacyParticleSystem (backup)
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.running = false;
      this.lastTime = 0;
      if (this.canvas.parentElement && this.canvas.parentElement !== document.body) {
        document.body.appendChild(this.canvas);
      }
      window.addEventListener("resize", () => this.resize());
      this.resize();
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(window.innerWidth));
      const height = Math.max(1, Math.floor(window.innerHeight));
      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    spawnConfetti(count = 80) {
      this.resize();
      const colors = ["#f2c94c", "#eb5757", "#2f80ed", "#6fcf97", "#bb6bd9"];
      for (let i = 0; i < count; i += 1) {
        this.particles.push({
          x: Math.random() * window.innerWidth,
          y: -20,
          vx: (Math.random() - 0.5) * 2,
          vy: Math.random() * 3 + 2,
          size: Math.random() * 6 + 4,
          color: colors[i % colors.length],
          life: 2000,
          type: "confetti"
        });
      }
      this.start();
    }

    spawnBalloons(count = 20) {
      this.resize();
      const colors = ["#ff6b6b", "#ffd93d", "#6bff95", "#6b9bff"];
      for (let i = 0; i < count; i += 1) {
        this.particles.push({
          x: Math.random() * window.innerWidth,
          y: window.innerHeight + 30,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -(Math.random() * 1.5 + 1),
          size: Math.random() * 16 + 12,
          color: colors[i % colors.length],
          life: 3000,
          type: "balloon"
        });
      }
      this.start();
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame((t) => this.loop(t));
    }

    loop(timestamp) {
      if (!this.running) return;
      const delta = timestamp - this.lastTime;
      this.lastTime = timestamp;
      this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      this.particles = this.particles.filter((p) => p.life > 0);
      for (const p of this.particles) {
        p.life -= delta;
        p.x += p.vx * delta * 0.1;
        p.y += p.vy * delta * 0.1;
        if (p.type === "confetti") {
          this.ctx.fillStyle = p.color;
          this.ctx.fillRect(p.x, p.y, p.size, p.size * 0.6);
        } else {
          this.ctx.fillStyle = p.color;
          this.ctx.beginPath();
          this.ctx.ellipse(p.x, p.y, p.size * 0.6, p.size, 0, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.strokeStyle = "rgba(0,0,0,0.2)";
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y + p.size);
          this.ctx.lineTo(p.x, p.y + p.size + 14);
          this.ctx.stroke();
        }
      }
      if (this.particles.length > 0) {
        requestAnimationFrame((t) => this.loop(t));
      } else {
        this.running = false;
      }
    }
  */

  class ParticleSystem {
    constructor(canvas, onPop = null) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.running = false;
      this.lastTime = 0;
      this.width = 0;
      this.height = 0;
      this.dpr = window.devicePixelRatio || 1;
      this.onPop = onPop;
      this.canvas.style.pointerEvents = "none";
      window.addEventListener("pointerdown", (event) => this.popAt(event.clientX, event.clientY));
      window.addEventListener("resize", () => this.resize());
      this.resize();
    }

    resize() {
      this.dpr = window.devicePixelRatio || 1;
      this.width = Math.max(1, Math.floor(window.innerWidth));
      this.height = Math.max(1, Math.floor(window.innerHeight));
      this.canvas.style.width = `${this.width}px`;
      this.canvas.style.height = `${this.height}px`;
      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    spawnConfetti(count = 120) {
      this.resize();
      const colors = ["#f2c94c", "#eb5757", "#2f80ed", "#6fcf97", "#bb6bd9", "#f2994a"];
      for (let i = 0; i < count; i += 1) {
        this.particles.push({
          type: "confetti",
          x: Math.random() * this.width,
          y: -20 - Math.random() * 80,
          vx: (Math.random() - 0.5) * 160,
          vy: Math.random() * 80 + 80,
          size: Math.random() * 6 + 6,
          life: 1.8 + Math.random() * 0.8,
          ttl: 2.6,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 6,
          color: colors[i % colors.length]
        });
      }
      this.start();
    }

    spawnConfettiAt(x, y, count = 28) {
      this.resize();
      const colors = ["#f2c94c", "#eb5757", "#2f80ed", "#6fcf97", "#bb6bd9", "#f2994a"];
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 180 + 120;
        this.particles.push({
          type: "confetti",
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 80,
          size: Math.random() * 6 + 5,
          life: 1.2 + Math.random() * 0.6,
          ttl: 2.2,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 8,
          color: colors[i % colors.length]
        });
      }
      this.start();
    }

    spawnBalloons(count = 24) {
      this.resize();
      const colors = ["#ff6b6b", "#ffd93d", "#6bff95", "#6b9bff", "#ff9fe2"];
      for (let i = 0; i < count; i += 1) {
        const size = Math.random() * 18 + 28;
        this.particles.push({
          type: "balloon",
          x: Math.random() * this.width,
          y: this.height + 60 + Math.random() * 120,
          vx: (Math.random() - 0.5) * 20,
          vy: -(Math.random() * 70 + 90),
          size,
          life: 12 + Math.random() * 3.5,
          ttl: 13.5,
          drift: Math.random() * 1.8 + 0.6,
          phase: Math.random() * Math.PI * 2,
          color: colors[i % colors.length]
        });
      }
      this.start();
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTime = performance.now();
      requestAnimationFrame((t) => this.loop(t));
    }

    loop(timestamp) {
      if (!this.running) return;
      const deltaMs = Math.min(64, timestamp - this.lastTime);
      const delta = deltaMs / 1000;
      this.lastTime = timestamp;
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.particles = this.particles.filter((p) => p.life > 0);

      for (const p of this.particles) {
        p.life -= delta;
        if (p.type === "confetti") {
          p.vy += 180 * delta;
          p.x += p.vx * delta;
          p.y += p.vy * delta;
          p.rot += p.vr * delta;
          this.ctx.save();
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate(p.rot);
          this.ctx.fillStyle = p.color;
          this.ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
          this.ctx.restore();
        } else {
          p.phase += delta * p.drift;
          p.x += p.vx * delta + Math.sin(p.phase) * 12 * delta;
          p.y += p.vy * delta;
          const rx = p.size * 0.62;
          const ry = p.size;
          this.ctx.fillStyle = p.color;

          // Balloon body (soft ellipse)
          this.ctx.beginPath();
          this.ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
          this.ctx.fill();

          // No extra highlight

          // Knot
          this.ctx.fillStyle = "rgba(0,0,0,0.18)";
          this.ctx.beginPath();
          this.ctx.ellipse(p.x, p.y + ry * 0.92, rx * 0.08, ry * 0.06, 0, 0, Math.PI * 2);
          this.ctx.fill();

          // String
          this.ctx.strokeStyle = "rgba(0,0,0,0.25)";
          this.ctx.lineWidth = 2;
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y + ry);
          this.ctx.bezierCurveTo(
            p.x - 8,
            p.y + ry + 26,
            p.x + 10,
            p.y + ry + 54,
            p.x - 4,
            p.y + ry + 84
          );
          this.ctx.stroke();
        }
      }

      if (this.particles.length > 0) {
        requestAnimationFrame((t) => this.loop(t));
      } else {
        this.running = false;
      }
    }

    popAt(clientX, clientY) {
      if (!this.particles.some((p) => p.type === "balloon")) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        if (p.type !== "balloon") continue;
        const rx = p.size * 0.62;
        const ry = p.size;
        const dx = (x - p.x) / rx;
        const dy = (y - p.y) / ry;
        if (dx * dx + dy * dy <= 1) {
          this.particles.splice(i, 1);
          this.spawnConfettiAt(p.x, p.y, 36);
          if (this.onPop) this.onPop();
          break;
        }
      }
    }
  }

  class UI {
    constructor(game) {
      this.game = game;
      this.dealerCards = document.getElementById("dealerCards");
      this.dealerTotal = document.getElementById("dealerTotal");
      this.handsEl = document.getElementById("hands");
      this.betTotal = document.getElementById("bet-total");
      this.bankrollValue = document.getElementById("bankrollValue");
      this.messageOverlay = document.getElementById("messageOverlay");
      this.messageText = document.getElementById("messageText");
      this.betSpot = document.getElementById("bet-spot");
      this.undoChipBtn = document.getElementById("undoChipBtn");
      this.buttons = {
        deal: document.getElementById("dealBtn"),
        hit: document.getElementById("hitBtn"),
        stand: document.getElementById("standBtn"),
        double: document.getElementById("doubleBtn"),
        split: document.getElementById("splitBtn"),
        surrender: document.getElementById("surrenderBtn"),
        insurance: document.getElementById("insuranceBtn"),
        clearBet: document.getElementById("clearBetBtn"),
        rebet: document.getElementById("rebetBtn"),
        settings: document.getElementById("settingsBtn")
      };
      this.vignette = document.createElement("div");
      this.vignette.className = "vignette";
      document.getElementById("table").appendChild(this.vignette);
    }

    updateBankroll(value) {
      this.bankrollValue.textContent = value.toString();
    }

    updateBet(value) {
      this.betTotal.textContent = value.toString();
      this.betTotal.classList.toggle("large", value >= 10000);
    }

    clearHands() {
      this.dealerCards.innerHTML = "";
      this.handsEl.innerHTML = "";
      this.dealerTotal.textContent = "?";
    }

    createHandElement(index) {
      const handEl = document.createElement("div");
      handEl.className = "hand";
      handEl.dataset.handIndex = index.toString();
      const cards = document.createElement("div");
      cards.className = "cards";
      const total = document.createElement("div");
      total.className = "total";
      total.textContent = "";
      handEl.appendChild(cards);
      handEl.appendChild(total);
      return handEl;
    }

    updateHandTotal(index, hand) {
      const handEl = this.getHandContainer(index);
      if (!handEl) return;
      const totalEl = handEl.querySelector(".total");
      if (hand.cards.length > 0) {
        const { total } = hand.getTotals();
        totalEl.textContent = hand.isBust() ? "BUST" : total.toString();
      } else {
        totalEl.textContent = "";
      }
    }

    getHandContainer(index) {
      return this.handsEl.querySelector(`[data-hand-index="${index}"]`);
    }

    renderHands(hands, activeIndex) {
      this.handsEl.innerHTML = "";
      hands.forEach((hand, idx) => {
        const handEl = this.createHandElement(idx);
        if (idx === activeIndex) handEl.classList.add("active");
        const totalEl = handEl.querySelector(".total");
        if (hand.cards.length > 0) {
          const { total } = hand.getTotals();
          totalEl.textContent = hand.isBust() ? "BUST" : total.toString();
        }
        this.handsEl.appendChild(handEl);
        for (let i = 0; i < hand.cards.length; i += 1) {
          const cardEl = createCardElement(hand.cards[i], false);
          handEl.querySelector(".cards").appendChild(cardEl);
        }
      });
    }

    renderDealer(hand, reveal = false) {
      this.dealerCards.innerHTML = "";
      hand.cards.forEach((card, idx) => {
        const faceDown = idx === 1 && !reveal;
        const cardEl = createCardElement(card, faceDown);
        this.dealerCards.appendChild(cardEl);
      });
      if (reveal) {
        const { total } = hand.getTotals();
        this.dealerTotal.textContent = total.toString();
      } else {
        this.dealerTotal.textContent = "?";
      }
    }

    highlightActiveHand(activeIndex) {
      const hands = this.handsEl.querySelectorAll(".hand");
      hands.forEach((el) => el.classList.remove("active"));
      const active = this.getHandContainer(activeIndex);
      if (active) active.classList.add("active");
    }

    async animateDeal(cardEl, targetEl) {
      const shoeRect = document.getElementById("shoe").getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const temp = cardEl.cloneNode(true);
      temp.classList.add("animate");
      temp.style.position = "fixed";
      temp.style.left = `${shoeRect.left}px`;
      temp.style.top = `${shoeRect.top}px`;
      temp.style.margin = "0";
      temp.style.zIndex = "999";
      temp.style.transition = "transform 0.7s ease, opacity 0.2s ease";
      temp.style.transform = "translate(0, 0) rotate(-10deg) scale(0.96)";
      document.body.appendChild(temp);

      const gapValue = getComputedStyle(targetEl).gap || "12px";
      const gap = Number(gapValue.replace("px", "")) || 12;
      const children = Array.from(targetEl.children);
      let targetX = targetRect.left;
      if (children.length > 0) {
        const lastRect = children[children.length - 1].getBoundingClientRect();
        targetX = lastRect.right + gap;
      }
      const targetY = targetRect.top;
      const dx = targetX - shoeRect.left;
      const dy = targetY - shoeRect.top;

      requestAnimationFrame(() => {
        temp.classList.add("in");
        temp.style.transform = `translate(${dx}px, ${dy}px) rotate(0) scale(1)`;
      });
      await sleep(720);
      temp.remove();
    }

    async animateChipToBetSpot(value) {
      const rackChip = document.querySelector(`#chip-rack .chip[data-value="${value}"]`);
      if (!rackChip) return;
      const startRect = rackChip.getBoundingClientRect();
      const targetRect = this.betSpot.getBoundingClientRect();
      const temp = rackChip.cloneNode(true);
      temp.style.position = "fixed";
      temp.style.left = `${startRect.left}px`;
      temp.style.top = `${startRect.top}px`;
      temp.style.margin = "0";
      temp.style.zIndex = "999";
      temp.style.transition = "transform 0.35s ease, opacity 0.2s ease";
      document.body.appendChild(temp);

      const dx = targetRect.left + targetRect.width / 2 - (startRect.left + startRect.width / 2);
      const dy = targetRect.top + targetRect.height / 2 - (startRect.top + startRect.height / 2);

      requestAnimationFrame(() => {
        temp.style.transform = `translate(${dx}px, ${dy}px) scale(0.85)`;
      });
      await sleep(360);
      temp.remove();
    }

    async animateToDiscard(cardEl) {
      const discardRect = document.getElementById("discard").getBoundingClientRect();
      const originRect = cardEl.getBoundingClientRect();
      const temp = cardEl.cloneNode(true);
      temp.style.position = "fixed";
      temp.style.left = `${originRect.left}px`;
      temp.style.top = `${originRect.top}px`;
      temp.style.margin = "0";
      temp.style.zIndex = "999";
      temp.style.transition = "transform 0.5s ease, opacity 0.2s ease";
      document.body.appendChild(temp);
      const dx = discardRect.left - originRect.left + 12;
      const dy = discardRect.top - originRect.top + 8;
      requestAnimationFrame(() => {
        temp.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
        temp.style.opacity = "0.3";
      });
      await sleep(520);
      temp.remove();
    }

    showMessage(text, duration = 1200, type = "neutral") {
      this.messageText.textContent = text;
      this.messageText.className = `message ${type}`;
      this.messageOverlay.classList.remove("hidden");
      setTimeout(() => {
        this.messageOverlay.classList.add("hidden");
      }, duration);
    }

    flashVignette() {
      this.vignette.classList.add("show");
      setTimeout(() => this.vignette.classList.remove("show"), 300);
    }

    updateButtons(state) {
      const { canDeal, canHit, canStand, canDouble, canSplit, canSurrender, canInsurance } = state;
      this.buttons.deal.disabled = !canDeal;
      this.buttons.hit.disabled = !canHit;
      this.buttons.stand.disabled = !canStand;
      this.buttons.double.disabled = !canDouble;
      this.buttons.split.disabled = !canSplit;
      this.buttons.surrender.disabled = !canSurrender;
      this.buttons.insurance.disabled = !canInsurance;
      this.buttons.clearBet.disabled = !state.canBet;
      this.buttons.rebet.disabled = !state.canBet || state.lastBet === 0;
      this.undoChipBtn.disabled = !state.canBet || state.betChips.length === 0;
    }
  }

  class Game {
    constructor() {
      this.settings = loadSettings();
      this.shoe = new Shoe(this.settings.numDecks);
      this.state = "betting";
      this.hands = [];
      this.dealerHand = new Hand(0, true);
      this.activeHandIndex = 0;
      this.bankroll = this.settings.bankroll;
      this.currentBet = 0;
      this.lastBet = 0;
      this.lastBetChips = [];
      this.betChips = [];
      this.selectedChipValue = 25;
      this.draggingChip = false;
      this.sideBets = {
        twentyOneThree: [],
        perfectPairs: [],
        bustBonus: [],
        luckyLadies: []
      };
      this.lastSideBets = {
        twentyOneThree: [],
        perfectPairs: [],
        bustBonus: [],
        luckyLadies: []
      };
      this.insuranceOffered = false;
      this.insuranceTaken = false;
      this.ui = new UI(this);
      this.audio = new AudioManager();
      this.particles = new ParticleSystem(document.getElementById("fxCanvas"), () => this.audio.playPop());
      this.rigQueue = [];
      this.initUI();
      this.render();
    }

    initUI() {
      const chipRack = document.getElementById("chip-rack");
      chipRack.innerHTML = "";
      CHIP_VALUES.forEach((value) => {
        const chip = document.createElement("div");
        let label = "";
        let classLabel = "";
        if (value === "max") {
          label = "MAX";
          classLabel = "max";
          chip.dataset.value = "max";
        } else if (value >= 1000) {
          label = `${value / 1000}k`;
          classLabel = label.toLowerCase();
          chip.dataset.value = value.toString();
        } else {
          label = value.toString();
          classLabel = label.toLowerCase();
          chip.dataset.value = value.toString();
        }
        chip.className = `chip chip-${classLabel}`;
        chip.textContent = label;
        chipRack.appendChild(chip);
      });

      this.highlightSelectedChip();
      this.setupDragAndDrop();
      this.setupChipClicks();

      this.ui.buttons.deal.addEventListener("click", () => this.deal());
      this.ui.buttons.hit.addEventListener("click", () => this.hit());
      this.ui.buttons.stand.addEventListener("click", () => this.stand());
      this.ui.buttons.double.addEventListener("click", () => this.doubleDown());
      this.ui.buttons.split.addEventListener("click", () => this.split());
      this.ui.buttons.surrender.addEventListener("click", () => this.surrender());
      this.ui.buttons.insurance.addEventListener("click", () => this.takeInsurance());
      this.ui.buttons.clearBet.addEventListener("click", () => this.clearBet());
      this.ui.buttons.rebet.addEventListener("click", () => this.rebet());
      this.ui.undoChipBtn.addEventListener("click", () => this.removeLastChip());

      const settingsBtn = document.getElementById("settingsBtn");
      const closeSettingsBtn = document.getElementById("closeSettingsBtn");
      const saveSettingsBtn = document.getElementById("saveSettingsBtn");
      const settingsModal = document.getElementById("settingsModal");
      const soundToggle = document.getElementById("soundToggle");
      const musicToggle = document.getElementById("musicToggle");
      const musicVolume = document.getElementById("musicVolume");
      const sfxVolume = document.getElementById("sfxVolume");
      const devPassword = document.getElementById("devPassword");
      const rigMode = document.getElementById("rigMode");
      const devStatus = document.getElementById("devStatus");
      const devPanel = document.getElementById("devPanel");
      const unlockDevBtn = document.getElementById("unlockDevBtn");
      const testConfettiBtn = document.getElementById("testConfettiBtn");
      const testBalloonsBtn = document.getElementById("testBalloonsBtn");

      settingsBtn.addEventListener("click", () => {
        this.populateSettings();
        devPassword.value = "";
        devPanel.classList.add("hidden");
        devStatus.textContent = "Developer Mode: OFF";
        settingsModal.classList.remove("hidden");
      });
      closeSettingsBtn.addEventListener("click", () => settingsModal.classList.add("hidden"));
      saveSettingsBtn.addEventListener("click", () => {
        this.saveSettings();
        settingsModal.classList.add("hidden");
      });

      const applyAudioSettings = () => {
        this.settings.sound = soundToggle.checked;
        this.settings.music = musicToggle.checked;
        this.settings.musicVolume = Number(musicVolume.value);
        this.settings.sfxVolume = Number(sfxVolume.value);
        saveSettings(this.settings);
        this.audio.setEnabled(this.settings.sound);
        this.audio.setMusicEnabled(this.settings.music);
        this.audio.setMusicVolume(this.settings.musicVolume);
        this.audio.setSfxVolume(this.settings.sfxVolume);
        musicVolume.disabled = !this.settings.music;
        sfxVolume.disabled = !this.settings.sound;
      };

      soundToggle.addEventListener("change", applyAudioSettings);
      musicToggle.addEventListener("change", applyAudioSettings);
      musicVolume.addEventListener("input", applyAudioSettings);
      sfxVolume.addEventListener("input", applyAudioSettings);

      const unlockDev = () => {
        const ok = devPassword.value === "maxxs";
        devPanel.classList.toggle("hidden", !ok);
        devStatus.textContent = ok ? "Developer Mode: ON" : "Developer Mode: OFF";
        rigMode.disabled = !ok;
      };

      unlockDevBtn.addEventListener("click", () => unlockDev());
      devPassword.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          unlockDev();
        }
      });

      testConfettiBtn.addEventListener("click", () => {
        this.particles.spawnConfetti(120);
      });

      testBalloonsBtn.addEventListener("click", () => {
        this.particles.spawnBalloons(24);
      });

      document.body.addEventListener("click", () => {
        this.audio.init();
        this.audio.setEnabled(this.settings.sound);
        this.audio.setMusicEnabled(this.settings.music);
        this.audio.setMusicVolume(this.settings.musicVolume);
        this.audio.setSfxVolume(this.settings.sfxVolume);
        this.audio.startMusic();
      }, { once: true });

      document.querySelectorAll(".side-bet-circle").forEach((el) => {
        el.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          const name = el.dataset.sidebet;
          if (name) this.removeLastSideBetChip(name);
        });
      });

      this.ui.betSpot.addEventListener("click", (event) => {
        if (!this.canBet()) return;
        if (event.target.closest("#undoChipBtn")) return;
        if (this.draggingChip) return;
        const value = this.selectedChipValue ?? CHIP_VALUES[0];
        if (value === "max") {
          const maxAmount = Math.max(0, this.bankroll - this.getSideBetTotal());
          if (maxAmount <= 0) return;
          this.ui.animateChipToBetSpot("max").then(() => this.addChip("max"));
          return;
        }
        const addAmount = value;
        if (this.currentBet + this.getSideBetTotal() + addAmount > this.bankroll) return;
        this.ui.animateChipToBetSpot(String(value))
          .then(() => this.addChip(addAmount));
      });
    }

    populateSettings() {
      document.getElementById("startBankrollInput").value = this.settings.bankroll;
      document.getElementById("numDecksInput").value = this.settings.numDecks;
      document.getElementById("insuranceToggle").checked = this.settings.insurance;
      document.getElementById("dasToggle").checked = this.settings.das;
      document.getElementById("surrenderToggle").checked = this.settings.surrender;
      document.getElementById("soundToggle").checked = this.settings.sound;
      document.getElementById("musicToggle").checked = this.settings.music;
      document.getElementById("musicVolume").value = this.settings.musicVolume;
      document.getElementById("sfxVolume").value = this.settings.sfxVolume;
      document.getElementById("rigMode").value = this.settings.rigMode || "normal";
      document.getElementById("musicVolume").disabled = !this.settings.music;
      document.getElementById("sfxVolume").disabled = !this.settings.sound;
    }

    saveSettings() {
      const bankroll = Number(document.getElementById("startBankrollInput").value || DEFAULTS.bankroll);
      const numDecks = Number(document.getElementById("numDecksInput").value || DEFAULTS.numDecks);
      const devPassword = document.getElementById("devPassword").value;
      const rigMode = document.getElementById("rigMode").value || "normal";
      const developerMode = devPassword === "maxxs";
      document.getElementById("devStatus").textContent = developerMode ? "Developer Mode: ON" : "Developer Mode: OFF";
      document.getElementById("rigMode").disabled = !developerMode;
      this.settings = {
        bankroll,
        numDecks,
        penetration: DEFAULTS.penetration,
        insurance: document.getElementById("insuranceToggle").checked,
        das: document.getElementById("dasToggle").checked,
        surrender: document.getElementById("surrenderToggle").checked,
        sound: document.getElementById("soundToggle").checked,
        music: document.getElementById("musicToggle").checked,
        musicVolume: Number(document.getElementById("musicVolume").value),
        sfxVolume: Number(document.getElementById("sfxVolume").value),
        developerMode,
        rigMode: developerMode ? rigMode : "normal"
      };
      saveSettings(this.settings);
      this.bankroll = this.settings.bankroll;
      this.audio.setEnabled(this.settings.sound);
      this.audio.setMusicEnabled(this.settings.music);
      this.audio.setMusicVolume(this.settings.musicVolume);
      this.shoe = new Shoe(this.settings.numDecks);
      this.resetRound();
    }

    setupDragAndDrop() {
      const rack = document.getElementById("chip-rack");
      const betSpot = this.ui.betSpot;
      let dragEl = null;
      let startPoint = null;

      rack.addEventListener("pointerdown", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip || !this.canBet()) return;
        const rawValue = chip.dataset.value;
        const value = rawValue === "max" ? "max" : Number(rawValue);
        const addAmount = value === "max" ? Math.max(0, this.bankroll - this.getSideBetTotal()) : value;
        if (addAmount <= 0) return;
        if (this.currentBet + this.getSideBetTotal() + addAmount > this.bankroll) return;
        this.selectedChipValue = value;
        this.highlightSelectedChip();
        dragEl = chip.cloneNode(true);
        dragEl.classList.add("dragging");
        document.body.appendChild(dragEl);
        dragEl.style.position = "fixed";
        dragEl.style.left = `${event.clientX - 28}px`;
        dragEl.style.top = `${event.clientY - 28}px`;
        dragEl.setPointerCapture(event.pointerId);
        startPoint = { x: event.clientX, y: event.clientY };
        this.draggingChip = false;

        const move = (e) => {
          const dx = Math.abs(e.clientX - startPoint.x);
          const dy = Math.abs(e.clientY - startPoint.y);
          if (dx > 6 || dy > 6) this.draggingChip = true;
          dragEl.style.left = `${e.clientX - 28}px`;
          dragEl.style.top = `${e.clientY - 28}px`;
        };
        const up = (e) => {
          dragEl.releasePointerCapture(e.pointerId);
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          const spotRect = betSpot.getBoundingClientRect();
          if (
            e.clientX >= spotRect.left &&
            e.clientX <= spotRect.right &&
            e.clientY >= spotRect.top &&
            e.clientY <= spotRect.bottom
          ) {
            this.addChip(value);
          } else {
            const circles = document.querySelectorAll(".side-bet-circle");
            circles.forEach((circle) => {
              const rect = circle.getBoundingClientRect();
              if (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
              ) {
                const name = circle.dataset.sidebet;
                if (name && value !== "max") this.addSideBetChip(name, value);
              }
            });
          }
          dragEl.remove();
          dragEl = null;
          startPoint = null;
          setTimeout(() => {
            this.draggingChip = false;
          }, 0);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
      });

      betSpot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.removeLastChip();
      });
    }

    setupChipClicks() {
      const rack = document.getElementById("chip-rack");
      rack.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");
        if (!chip || !this.canBet()) return;
        if (this.draggingChip) return;
        const rawValue = chip.dataset.value;
        const value = rawValue === "max" ? "max" : Number(rawValue);
        this.selectedChipValue = value;
        this.highlightSelectedChip();
      });
    }

    highlightSelectedChip() {
      const rack = document.getElementById("chip-rack");
      rack.querySelectorAll(".chip").forEach((chip) => {
        const rawValue = chip.dataset.value;
        const value = rawValue === "max" ? "max" : Number(rawValue);
        chip.classList.toggle("selected", value === this.selectedChipValue);
      });
    }

    getMaxAddAmount() {
      return Math.max(0, this.bankroll - this.currentBet - this.getSideBetTotal());
    }

    canBet() {
      return this.state === "betting" || this.state === "roundOver";
    }

    addChip(value) {
      if (!this.canBet()) return;
      if (value === "max") {
        const maxAmount = Math.max(0, this.bankroll - this.getSideBetTotal());
        if (maxAmount <= 0) return;
        this.currentBet = maxAmount;
        this.betChips = ["max"];
        this.renderBetStack();
        this.render();
        return;
      }
      if (this.currentBet + this.getSideBetTotal() + value > this.bankroll) return;
      this.currentBet += value;
      this.betChips.push(value);
      this.renderBetStack();
      this.render();
    }

    removeLastChip() {
      if (!this.canBet() || this.betChips.length === 0) return;
      const value = this.betChips.pop();
      if (value === "max") {
        this.currentBet = 0;
      } else {
        this.currentBet -= value;
      }
      this.renderBetStack();
      this.render();
    }

    getSideBetTotal() {
      return Object.values(this.sideBets).reduce((sum, arr) => sum + arr.reduce((s, v) => s + v, 0), 0);
    }

    addSideBetChip(name, value) {
      if (!this.canBet()) return;
      const total = this.currentBet + this.getSideBetTotal() + value;
      if (total > this.bankroll) return;
      this.sideBets[name].push(value);
      this.renderSideBets();
      this.render();
    }

    removeLastSideBetChip(name) {
      if (!this.canBet() || this.sideBets[name].length === 0) return;
      this.sideBets[name].pop();
      this.renderSideBets();
      this.render();
    }

    clearBet() {
      if (!this.canBet()) return;
      this.currentBet = 0;
      this.betChips = [];
      this.sideBets = {
        twentyOneThree: [],
        perfectPairs: [],
        bustBonus: [],
        luckyLadies: []
      };
      this.renderBetStack();
      this.renderSideBets();
      this.render();
    }

    rebet() {
      if (!this.canBet()) return;
      if (this.lastBetChips.length === 0) return;
      if (this.lastBetChips.includes("max")) {
        const maxAmount = Math.max(0, this.bankroll - this.getSideBetTotal());
        if (maxAmount <= 0) return;
        this.currentBet = maxAmount;
        this.betChips = ["max"];
        this.renderBetStack();
        this.renderSideBets();
        this.render();
        return;
      }
      const total = this.lastBetChips.reduce((sum, v) => sum + v, 0);
      const sideTotal = Object.values(this.lastSideBets).reduce((sum, arr) => sum + arr.reduce((s, v) => s + v, 0), 0);
      if (total + sideTotal === 0 || total + sideTotal > this.bankroll) return;
      this.currentBet = total;
      this.betChips = [...this.lastBetChips];
      this.sideBets = {
        twentyOneThree: [...this.lastSideBets.twentyOneThree],
        perfectPairs: [...this.lastSideBets.perfectPairs],
        bustBonus: [...this.lastSideBets.bustBonus],
        luckyLadies: [...this.lastSideBets.luckyLadies]
      };
      this.renderBetStack();
      this.renderSideBets();
      this.render();
    }

    renderBetStack() {
      let stack = document.querySelector(".bet-stack");
      if (!stack) {
        stack = document.createElement("div");
        stack.className = "bet-stack";
        this.ui.betSpot.appendChild(stack);
      }
      stack.innerHTML = "";
      this.betChips.forEach((value, idx) => {
        const chip = document.createElement("div");
        let label = "";
        if (value === "max") {
          label = "MAX";
        } else if (value >= 1000) {
          label = `${value / 1000}k`;
        } else {
          label = value.toString();
        }
        chip.className = `chip chip-${label.toLowerCase()}`;
        chip.textContent = label;
        chip.style.transform = "translateY(0)";
        chip.style.zIndex = (100 + idx).toString();
        stack.appendChild(chip);
      });

      if (this.currentBet > 0) {
        const counter = document.createElement("div");
        counter.className = "bet-count";
        counter.textContent = `BET ${this.currentBet}`;
        stack.appendChild(counter);
      }
    }

    renderSideBets() {
      document.querySelectorAll(".side-bet-circle").forEach((el) => {
        const name = el.dataset.sidebet;
        if (!name) return;
        let stack = el.querySelector(".sidebet-stack");
        if (!stack) {
          stack = document.createElement("div");
          stack.className = "sidebet-stack";
          el.appendChild(stack);
        }
        stack.innerHTML = "";
        const chips = this.sideBets[name];
        chips.forEach((value, idx) => {
          const chip = document.createElement("div");
          chip.className = `chip chip-${value}`;
          chip.textContent = value.toString();
          chip.style.zIndex = (100 + idx).toString();
          stack.appendChild(chip);
        });
        if (chips.length > 0) {
          const counter = document.createElement("div");
          counter.className = "sidebet-count";
          const total = chips.reduce((sum, v) => sum + v, 0);
          counter.textContent = `$${total}`;
          stack.appendChild(counter);
        }
      });
    }

    async deal() {
      if (!this.canBet() || this.currentBet === 0) return;
      if (this.currentBet + this.getSideBetTotal() > this.bankroll) return;
      if (this.shoe.needsShuffle(this.settings.penetration)) {
        this.shoe = new Shoe(this.settings.numDecks);
      }

      this.ui.clearHands();
      this.state = "dealing";
      this.lastBet = this.currentBet;
      this.lastBetChips = [...this.betChips];
      this.lastSideBets = {
        twentyOneThree: [...this.sideBets.twentyOneThree],
        perfectPairs: [...this.sideBets.perfectPairs],
        bustBonus: [...this.sideBets.bustBonus],
        luckyLadies: [...this.sideBets.luckyLadies]
      };
      this.bankroll -= this.currentBet;
      this.bankroll -= this.getSideBetTotal();
      this.hands = [new Hand(this.currentBet)];
      this.dealerHand = new Hand(0, true);
      this.activeHandIndex = 0;
      this.insuranceOffered = false;
      this.insuranceTaken = false;
      this.prepareRig();
      this.ui.clearHands();
      this.ui.updateBankroll(this.bankroll);
      this.render();

      await this.dealCardToHand(this.hands[0], this.ui.getHandContainer(0));
      await sleep(180);
      await this.dealCardToDealer();
      await sleep(180);
      await this.dealCardToHand(this.hands[0], this.ui.getHandContainer(0));
      await sleep(180);
      await this.dealCardToDealer(true);

      this.state = "player";
      this.checkInitials();
      this.render();
    }

    async dealCardToHand(hand, handEl) {
      const card = this.drawCard();
      hand.addCard(card);
      const cardEl = createCardElement(card, false);
      const cardsEl = handEl.querySelector(".cards");
      this.audio.playSwish();
      await this.ui.animateDeal(cardEl, cardsEl);
      cardsEl.appendChild(cardEl);
      await sleep(120);
      this.ui.updateHandTotal(this.activeHandIndex, hand);
    }

    async dealCardToDealer(faceDown = false) {
      const card = this.drawCard();
      this.dealerHand.addCard(card);
      const cardEl = createCardElement(card, faceDown);
      this.dealerCards = this.ui.dealerCards;
      this.audio.playSwish();
      await this.ui.animateDeal(cardEl, this.dealerCards);
      this.dealerCards.appendChild(cardEl);
      await sleep(120);
      if (!faceDown) {
        this.ui.renderDealer(this.dealerHand, false);
      }
    }

    async checkInitials() {
      const playerHand = this.hands[0];
      const dealerUpcard = this.dealerHand.cards[0];
      if (dealerUpcard.rank === "A" && this.settings.insurance) {
        this.insuranceOffered = true;
        this.ui.showMessage("INSURANCE?");
      }

      const dealerBlackjack = this.dealerHand.isBlackjack();
      const playerBlackjack = playerHand.isBlackjack();

      if (playerBlackjack || dealerBlackjack) {
        await sleep(300);
        await this.revealDealerHole();
        this.resolveRound();
        return;
      }

      if (playerHand.isBlackjack()) {
        await sleep(300);
        await this.revealDealerHole();
        this.resolveRound();
      }
    }

    declineInsurance() {
      this.insuranceOffered = false;
      this.render();
    }

    takeInsurance() {
      if (!this.insuranceOffered || this.insuranceTaken) return;
      const hand = this.hands[0];
      const insuranceBet = Math.min(hand.bet / 2, this.bankroll);
      if (insuranceBet <= 0) return;
      this.bankroll -= insuranceBet;
      hand.insuranceBet = insuranceBet;
      this.insuranceTaken = true;
      this.insuranceOffered = false;
      this.render();
    }

    autoDeclineInsurance() {
      if (this.insuranceOffered && !this.insuranceTaken) {
        this.insuranceOffered = false;
      }
    }

    async hit() {
      if (this.state !== "player") return;
      this.autoDeclineInsurance();
      const hand = this.hands[this.activeHandIndex];
      await this.hitHand(hand);
      this.afterPlayerAction(hand);
    }

    async hitHand(hand) {
      const handEl = this.ui.getHandContainer(this.activeHandIndex);
      const card = this.drawCard();
      hand.addCard(card);
      const cardEl = createCardElement(card, false);
      const cardsEl = handEl.querySelector(".cards");
      this.audio.playSwish();
      await this.ui.animateDeal(cardEl, cardsEl);
      cardsEl.appendChild(cardEl);
      this.ui.updateHandTotal(this.activeHandIndex, hand);
    }

    stand() {
      if (this.state !== "player") return;
      this.autoDeclineInsurance();
      this.advanceHand();
    }

    async doubleDown() {
      if (this.state !== "player") return;
      this.autoDeclineInsurance();
      const hand = this.hands[this.activeHandIndex];
      if (!this.canDouble(hand)) return;
      if (this.bankroll < hand.bet) return;
      this.bankroll -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      await this.hitHand(hand);
      hand.complete = true;
      this.advanceHand();
    }

    async split() {
      if (this.state !== "player") return;
      this.autoDeclineInsurance();
      const hand = this.hands[this.activeHandIndex];
      if (!this.canSplit(hand)) return;
      if (this.bankroll < hand.bet) return;

      this.bankroll -= hand.bet;
      const newHand = new Hand(hand.bet);
      const cardToMove = hand.cards.pop();
      newHand.cards.push(cardToMove);
      this.hands.splice(this.activeHandIndex + 1, 0, newHand);

      if (hand.cards[0].rank === "A") {
        hand.isSplitAces = true;
        newHand.isSplitAces = true;
      }

      this.ui.renderHands(this.hands, this.activeHandIndex);
      await this.hitHand(hand);
      this.activeHandIndex += 1;
      await this.hitHand(this.hands[this.activeHandIndex]);

      if (hand.isSplitAces) {
        hand.complete = true;
      }
      if (newHand.isSplitAces) {
        newHand.complete = true;
      }

      this.activeHandIndex = 0;
      this.ui.renderHands(this.hands, this.activeHandIndex);
      this.advanceIfComplete();
    }

    surrender() {
      if (!this.settings.surrender) return;
      if (this.state !== "player") return;
      this.autoDeclineInsurance();
      const hand = this.hands[this.activeHandIndex];
      if (hand.cards.length !== 2 || hand.doubled) return;
      hand.surrendered = true;
      hand.complete = true;
      this.bankroll += hand.bet / 2;
      this.ui.showMessage("SURRENDER");
      this.advanceHand();
    }

    async revealDealerHole() {
      const holeCard = this.ui.dealerCards.children[1];
      if (holeCard) {
        holeCard.classList.remove("face-down");
      }
      await sleep(400);
      this.ui.renderDealer(this.dealerHand, true);
    }

    async dealerPlay() {
      await this.revealDealerHole();
      let { total } = this.dealerHand.getTotals();
      while (total < 17) {
        const card = this.drawCard();
        this.dealerHand.addCard(card);
        const cardEl = createCardElement(card, false);
        this.ui.dealerCards.appendChild(cardEl);
        await this.ui.animateDeal(cardEl, cardEl);
        ({ total } = this.dealerHand.getTotals());
        this.ui.renderDealer(this.dealerHand, true);
      }
      this.dealerHand.complete = true;
    }

    drawCard() {
      if (this.rigQueue.length > 0) {
        const rigged = this.rigQueue.shift();
        if (rigged) return rigged;
      }
      return this.shoe.draw();
    }

    prepareRig() {
      this.rigQueue = [];
      if (!this.settings.developerMode || this.settings.rigMode === "normal") return;

      const randomRank = () => RANKS[Math.floor(Math.random() * RANKS.length)];
      const takeCard = (rank) => {
        const index = this.shoe.cards.findIndex((card) => card.rank === rank);
        if (index === -1) return this.shoe.draw();
        return this.shoe.cards.splice(index, 1)[0];
      };

      const takeCardNot = (rank) => {
        const index = this.shoe.cards.findIndex((card) => card.rank !== rank);
        if (index === -1) return this.shoe.draw();
        return this.shoe.cards.splice(index, 1)[0];
      };

      const add = (rank) => this.rigQueue.push(takeCard(rank));
      const addNot = (rank) => this.rigQueue.push(takeCardNot(rank));

      switch (this.settings.rigMode) {
        case "player-bj":
          add("A");
          addNot("A");
          add("K");
          addNot("10");
          break;
        case "dealer-bj":
          add("10");
          add("A");
          add("9");
          add("K");
          break;
        case "player-win":
          add("10");
          add("9");
          add("8");
          add("6");
          add("10");
          break;
        case "player-lose":
          add("10");
          add("10");
          add("6");
          add("9");
          break;
        case "always-split":
          {
            const rank = randomRank();
            add(rank);
            addNot(rank);
            add(rank);
            addNot(rank);
          }
          break;
        default:
          break;
      }
    }

    afterPlayerAction(hand) {
      if (hand.isBust()) {
        hand.complete = true;
        this.ui.showMessage("BUST", 1200, "bust");
        this.audio.playBust();
        this.ui.flashVignette();
        this.advanceHand();
        return;
      }
      if (hand.isSplitAces) {
        hand.complete = true;
        this.advanceHand();
      }
    }

    advanceIfComplete() {
      const hand = this.hands[this.activeHandIndex];
      if (hand.complete) this.advanceHand();
    }

    async advanceHand() {
      let nextIndex = this.activeHandIndex + 1;
      while (nextIndex < this.hands.length && this.hands[nextIndex].complete) {
        nextIndex += 1;
      }
      if (nextIndex < this.hands.length) {
        this.activeHandIndex = nextIndex;
        this.ui.highlightActiveHand(this.activeHandIndex);
      } else {
        this.state = "dealer";
        await this.dealerPlay();
        this.resolveRound();
      }
      this.render();
    }

    resolveRound() {
      const dealerTotals = this.dealerHand.getTotals();
      const dealerBust = this.dealerHand.isBust();
      const dealerBlackjack = this.dealerHand.isBlackjack();

      let summary = [];
      let anyWin = false;
      let blackjackWin = false;
      let blackjackCelebration = false;
      let anyPush = false;
      let anyLose = false;

      this.hands.forEach((hand, idx) => {
        let result = "";
        if (hand.surrendered) {
          result = `HAND ${idx + 1} SURRENDER`;
          anyLose = true;
        } else if (hand.isBlackjack()) {
          blackjackCelebration = true;
          if (dealerBlackjack) {
            this.bankroll += hand.bet;
            result = `HAND ${idx + 1} PUSH`;
            anyPush = true;
          } else {
            this.bankroll += hand.bet * 2.5;
            result = `HAND ${idx + 1} BLACKJACK`;
            blackjackWin = true;
            anyWin = true;
          }
        } else if (hand.isBust()) {
          result = `HAND ${idx + 1} BUST`;
          anyLose = true;
        } else {
          const playerTotal = hand.getTotals().total;
          if (dealerBust) {
            this.bankroll += hand.bet * 2;
            result = `HAND ${idx + 1} WIN`;
            anyWin = true;
          } else if (dealerBlackjack) {
            result = `HAND ${idx + 1} LOSE`;
            anyLose = true;
          } else if (playerTotal > dealerTotals.total) {
            this.bankroll += hand.bet * 2;
            result = `HAND ${idx + 1} WIN`;
            anyWin = true;
          } else if (playerTotal < dealerTotals.total) {
            result = `HAND ${idx + 1} LOSE`;
            anyLose = true;
          } else {
            this.bankroll += hand.bet;
            result = `HAND ${idx + 1} PUSH`;
            anyPush = true;
          }
        }
        summary.push(result);
      });

      if (this.hands[0].insuranceBet > 0 && dealerBlackjack) {
        this.bankroll += this.hands[0].insuranceBet * 3;
        summary.push("INSURANCE WIN");
        anyWin = true;
      }

      if (dealerBust) summary.unshift("DEALER BUST");
      if (dealerBlackjack) summary.unshift("DEALER BLACKJACK");

      const message = summary.join(" • ");
      const summaryHasWin = summary.some((entry) => entry.includes("WIN") || entry.includes("BLACKJACK"));
      const summaryHasBlackjack = summary.some((entry) => entry.includes("BLACKJACK"));
      let messageType = "neutral";
      if (blackjackCelebration || anyWin || summaryHasWin) {
        messageType = "win";
      } else if (anyPush && !anyLose) {
        messageType = "push";
      } else if (anyLose) {
        messageType = "lose";
      }
      this.ui.showMessage(message, 1800, messageType);

      this.celebrateOutcome({
        win: anyWin || summaryHasWin,
        blackjack: blackjackCelebration || summaryHasBlackjack
      });

      this.state = "roundOver";
      this.finishRound();
    }

    celebrateOutcome({ win, blackjack }) {
      if (!win && !blackjack) return;
      setTimeout(() => {
        if (blackjack) {
          this.particles.spawnConfetti(170);
          this.particles.spawnBalloons(24);
          this.audio.playBlackjack();
        }
        if (win) {
          this.particles.spawnConfetti(120);
          this.audio.playWin();
        }
      }, 120);
    }

    finishRound() {
      this.currentBet = 0;
      this.betChips = [];
      this.renderBetStack();
      const allCards = [
        ...this.ui.dealerCards.querySelectorAll(".card"),
        ...this.ui.handsEl.querySelectorAll(".card")
      ];
      allCards.forEach((card) => {
        this.ui.animateToDiscard(card);
      });
      this.hands.forEach((hand) => this.shoe.discardHand(hand));
      this.shoe.discardHand(this.dealerHand);
      this.sideBets = {
        twentyOneThree: [],
        perfectPairs: [],
        bustBonus: [],
        luckyLadies: []
      };
      this.renderSideBets();
      this.render();
    }

    resetRound() {
      this.state = "betting";
      this.hands = [];
      this.dealerHand = new Hand(0, true);
      this.activeHandIndex = 0;
      this.ui.clearHands();
      this.insuranceOffered = false;
      this.insuranceTaken = false;
      this.ui.updateBankroll(this.bankroll);
      this.render();
    }

    canDouble(hand) {
      if (hand.cards.length !== 2) return false;
      if (hand.isSplitAces) return false;
      if (this.hands.length > 1 && !this.settings.das) return false;
      return true;
    }

    canSplit(hand) {
      if (!hand.canSplit()) return false;
      const splits = this.hands.length - 1;
      return splits < 3;
    }

    getButtonState() {
      const canBet = this.canBet();
      const hand = this.hands[this.activeHandIndex];
      return {
        canDeal: canBet && this.currentBet > 0 && this.currentBet + this.getSideBetTotal() <= this.bankroll,
        canHit: this.state === "player" && hand && !hand.complete,
        canStand: this.state === "player" && hand && !hand.complete,
        canDouble: this.state === "player" && hand && this.canDouble(hand) && this.bankroll >= hand.bet,
        canSplit: this.state === "player" && hand && this.canSplit(hand) && this.bankroll >= hand.bet,
        canSurrender: this.state === "player" && this.settings.surrender && hand && hand.cards.length === 2 && !hand.doubled,
        canInsurance: this.state === "player" && this.insuranceOffered && !this.insuranceTaken,
        canBet,
        lastBet: this.lastBet,
        betChips: this.betChips
      };
    }

    render() {
      this.ui.updateBankroll(this.bankroll);
      this.ui.updateBet(this.currentBet);
      this.ui.updateButtons(this.getButtonState());
      if (this.hands.length > 0) {
        this.ui.renderHands(this.hands, this.activeHandIndex);
      }
      if (this.dealerHand.cards.length > 0) {
        this.ui.renderDealer(this.dealerHand, this.state !== "player" ? true : false);
      }
      this.renderSideBets();
    }
  }

  function createCardElement(card, faceDown) {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    if (faceDown) cardEl.classList.add("face-down");
    if (card.suit === "H" || card.suit === "D") cardEl.classList.add("red");

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const face = document.createElement("div");
    face.className = "card-face";

    const cornerTop = document.createElement("div");
    cornerTop.className = "card-corner";
    cornerTop.innerHTML = `${card.rank}${SUIT_SYMBOLS[card.suit]}`;

    const suit = document.createElement("div");
    suit.className = "card-suit";
    suit.innerHTML = SUIT_SYMBOLS[card.suit];

    const cornerBottom = document.createElement("div");
    cornerBottom.className = "card-corner";
    cornerBottom.innerHTML = `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
    cornerBottom.style.transform = "rotate(180deg)";

    face.appendChild(cornerTop);
    face.appendChild(suit);
    face.appendChild(cornerBottom);

    const back = document.createElement("div");
    back.className = "card-back";

    inner.appendChild(face);
    inner.appendChild(back);
    cardEl.appendChild(inner);
    return cardEl;
  }

  function loadSettings() {
    const stored = localStorage.getItem("blackj-settings");
    if (!stored) return { ...DEFAULTS };
    try {
      return { ...DEFAULTS, ...JSON.parse(stored) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem("blackj-settings", JSON.stringify(settings));
  }

  window.addEventListener("load", () => {
    new Game();
  });
})();
