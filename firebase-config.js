// Not committed to git (see .gitignore) — this is per-deployment config, not
// a shared secret (Firebase client config is safe to expose publicly; real
// access control lives in Firestore security rules, not in hiding this file).
// Loaded via its own <script> tag, before engine/multiplayer.js.
window.GN_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDbYS5HfhFE8z5l-O_tmkE8kd-_uFgXzVw",
  authDomain: "geoshrink-da1f8.firebaseapp.com",
  projectId: "geoshrink-da1f8",
  storageBucket: "geoshrink-da1f8.firebasestorage.app",
  messagingSenderId: "983092381611",
  appId: "1:983092381611:web:8068bdb638c47d95e474ee",
};
