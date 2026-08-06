(function () {
  const GN = window.GN = window.GN || {};

  // Thin Firestore wrapper — deliberately holds no game logic. Room-state
  // interpretation (round/step generation, scoring, step resolution) lives
  // in modes/multiplayer.js, which reads/writes room documents through the
  // generic primitives here. Uses the Firebase compat/namespaced CDN SDK to
  // match this codebase's plain-<script>, non-module GN.* pattern.
  //
  // Identity (the Firebase app instance, Auth session, anonymous sign-in) is
  // owned entirely by engine/account.js — this module only asks it for a
  // UID, rather than running a second, independent auth flow that could end
  // up signed in as someone else. A signed-in (not just anonymous) player's
  // multiplayer rooms follow that same UID automatically, for free.

  let db;
  let roomUnsub = null;

  function available() {
    return !!(window.GN && GN.account && GN.account.available());
  }

  function init() {
    if (db) return;
    if (!available()) throw new Error('Multiplayer needs a Firebase project config.');
    db = firebase.firestore();
  }

  function signIn() {
    init();
    return GN.account.ensureAnonymous().then((user) => user.uid);
  }

  function getUid() { return GN.account.getUid(); }

  // No ambiguous chars (0/O, 1/I/L) — this is read aloud/typed by hand.
  function randomRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  function createRoom(difficulty, name) {
    return signIn().then((uid) => {
      function attempt(triesLeft) {
        const code = randomRoomCode();
        const ref = db.collection('rooms').doc(code);
        return ref.get().then((snap) => {
          if (snap.exists) {
            if (triesLeft <= 0) throw new Error('Could not generate a free room code — try again.');
            return attempt(triesLeft - 1);
          }
          return ref.set({
            status: 'lobby',
            hostUid: uid,
            difficulty,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            players: { [uid]: { name, connected: true, joinedAt: Date.now() } },
            currentRound: 0,
            currentStep: 0,
            stepDeadline: 0,
            hostHeartbeatAt: Date.now(),
            rounds: {},
            submissions: {},
            scores: { [uid]: 0 },
            roundScores: {},
          }).then(() => code);
        });
      }
      return attempt(5);
    });
  }

  function joinRoom(roomCode, name) {
    return signIn().then((uid) => {
      const ref = db.collection('rooms').doc(roomCode);
      return db.runTransaction((tx) => tx.get(ref).then((snap) => {
        if (!snap.exists) throw new Error('Room not found — check the code and try again.');
        const data = snap.data();
        if (data.status !== 'lobby') throw new Error('That match has already started.');
        const players = data.players || {};
        players[uid] = { name, connected: true, joinedAt: Date.now() };
        const scores = data.scores || {};
        if (scores[uid] == null) scores[uid] = 0;
        tx.update(ref, { players, scores });
      })).then(() => roomCode);
    });
  }

  function subscribeRoom(roomCode, cb) {
    unsubscribeRoom();
    roomUnsub = db.collection('rooms').doc(roomCode).onSnapshot(
      (snap) => { if (snap.exists) cb(Object.assign({ id: snap.id }, snap.data())); else cb(null); },
      () => cb(null)
    );
    return roomUnsub;
  }
  function unsubscribeRoom() {
    if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  }

  function updateRoom(roomCode, updates) {
    return db.collection('rooms').doc(roomCode).update(updates);
  }

  function submitPick(roomCode, choice) {
    const uid = getUid();
    return updateRoom(roomCode, { ['submissions.' + uid]: { choice, submittedAt: Date.now() } });
  }

  function setConnected(roomCode, connected) {
    const uid = getUid();
    if (!uid) return Promise.resolve();
    return updateRoom(roomCode, { ['players.' + uid + '.connected']: connected }).catch(() => {});
  }

  GN.multiplayer = {
    available, signIn, getUid,
    createRoom, joinRoom, subscribeRoom, unsubscribeRoom,
    updateRoom, submitPick, setConnected,
  };
})();
