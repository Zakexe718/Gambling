/* ==========================================================================
   NOV'ASINO — Connexion Discord (OAuth2, flow PKCE, "client public")
   Aucun secret client n'est utilisé : tout se passe côté navigateur.
   ========================================================================== */

// 👉 À REMPLACER : colle ici le Client ID de ton application Discord
// (discord.com/developers/applications → ton app → OAuth2 → Client ID)
const DISCORD_CLIENT_ID = "1543298376790048808";

const DISCORD_SCOPE = "identify";
const STORAGE_KEY = "novasino_discord_user";

/* ---------------------------------------------------------------------- */
/* Utilitaires PKCE                                                        */
/* ---------------------------------------------------------------------- */

function b64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return b64urlEncode(arr.buffer);
}

async function sha256(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

function currentRedirectUri() {
  // Toujours la page actuelle (sans query string) : chaque page de jeu
  // doit être enregistrée comme Redirect URI côté Discord.
  return window.location.origin + window.location.pathname;
}

/* ---------------------------------------------------------------------- */
/* Connexion                                                                */
/* ---------------------------------------------------------------------- */

async function discordLogin() {
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "COLLE_TON_CLIENT_ID_ICI") {
    alert("Connexion Discord non configurée : ajoute ton Client ID dans discord-auth.js");
    return;
  }

  const verifier = randomString(64);
  const state = randomString(16);
  sessionStorage.setItem('novasino_pkce_verifier', verifier);
  sessionStorage.setItem('novasino_oauth_state', state);

  const challenge = b64urlEncode(await sha256(verifier));

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DISCORD_CLIENT_ID,
    scope: DISCORD_SCOPE,
    redirect_uri: currentRedirectUri(),
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
  });

  window.location.href = `https://discord.com/oauth2/authorize?${params.toString()}`;
}

function discordLogout() {
  localStorage.removeItem(STORAGE_KEY);
  renderDiscordAuthWidget();
}

/* ---------------------------------------------------------------------- */
/* Lecture de l'utilisateur connecté                                        */
/* ---------------------------------------------------------------------- */

function getDiscordUser() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data.expires_at && Date.now() > data.expires_at) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return data;
  } catch (e) {
    return null;
  }
}

// À utiliser avant une action de jeu : alerte + null si pas connecté
function getPseudo() {
  const user = getDiscordUser();
  if (!user) {
    alert('Connecte-toi avec Discord avant de jouer !');
    return null;
  }
  return user.username;
}

// À utiliser juste pour afficher/loguer un nom sans bloquer le flux
function currentPseudo() {
  const user = getDiscordUser();
  return user ? user.username : 'Inconnu';
}

/* ---------------------------------------------------------------------- */
/* Échange du code contre un token, puis récupération du profil            */
/* ---------------------------------------------------------------------- */

async function exchangeCodeForToken(code, verifier) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: currentRedirectUri(),
    code_verifier: verifier
  });

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });

  if (!res.ok) throw new Error('token_exchange_failed');
  return res.json();
}

async function fetchDiscordProfile(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('profile_fetch_failed');
  return res.json();
}

function avatarUrl(user) {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

/* ---------------------------------------------------------------------- */
/* Retour depuis Discord (?code=...&state=...)                             */
/* ---------------------------------------------------------------------- */

async function handleDiscordRedirect() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return;

  const savedState = sessionStorage.getItem('novasino_oauth_state');
  const verifier = sessionStorage.getItem('novasino_pkce_verifier');

  // Nettoie l'URL tout de suite (retire ?code=...&state=...)
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState({}, document.title, url.pathname + url.hash);

  if (!verifier || state !== savedState) {
    console.warn("État OAuth invalide : connexion annulée.");
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, verifier);
    const profile = await fetchDiscordProfile(token.access_token);
    const username = profile.global_name || profile.username;

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: profile.id,
      username: username,
      avatar: profile.avatar,
      access_token: token.access_token,
      expires_at: Date.now() + token.expires_in * 1000
    }));
  } catch (e) {
    console.error(e);
    alert(
      "La connexion Discord a échoué. Vérifie que :\n" +
      "- le Client ID dans discord-auth.js est correct\n" +
      "- l'option \"Public Client\" est activée sur l'app Discord\n" +
      "- l'URL exacte de cette page est bien enregistrée comme Redirect URI"
    );
  } finally {
    sessionStorage.removeItem('novasino_pkce_verifier');
    sessionStorage.removeItem('novasino_oauth_state');
  }
}

/* ---------------------------------------------------------------------- */
/* Rendu du bouton / badge de connexion                                    */
/* ---------------------------------------------------------------------- */

function renderDiscordAuthWidget() {
  const el = document.getElementById('discordAuthWidget');
  if (!el) return;

  const user = getDiscordUser();

  if (user) {
    const img = avatarUrl(user);
    el.innerHTML = `
      <div class="discord-user-badge">
        ${img ? `<img src="${img}" alt="">` : '<span class="discord-avatar-fallback">🎮</span>'}
        <span>Connecté : <strong>${user.username}</strong></span>
        <button type="button" class="discord-logout-btn" onclick="discordLogout()">Déconnexion</button>
      </div>`;
  } else {
    el.innerHTML = `
      <button type="button" class="discord-login-btn" onclick="discordLogin()">
        <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>
        Se connecter avec Discord
      </button>`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await handleDiscordRedirect();
  renderDiscordAuthWidget();
});
