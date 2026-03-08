const express = require('express');
const axios = require('axios');
const router = express.Router();

const SALLA_OAUTH_URL = process.env.SALLA_OAUTH_URL || 'https://accounts.salla.sa/oauth2/auth';
const SALLA_TOKEN_URL = process.env.SALLA_TOKEN_URL || 'https://accounts.salla.sa/oauth2/token';
const CLIENT_ID = process.env.SALLA_CLIENT_ID;
const CLIENT_SECRET = process.env.SALLA_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Redirect to Salla OAuth
router.get('/login', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${APP_URL}/auth/callback`,
    response_type: 'code',
    scope: 'offline_access',
    state: Math.random().toString(36).substring(2)
  });

  res.redirect(`${SALLA_OAUTH_URL}?${params.toString()}`);
});

// OAuth callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect('/pages/error.html?msg=' + encodeURIComponent('فشل تسجيل الدخول. حاول مرة أخرى.'));
  }

  try {
    const tokenResponse = await axios.post(
      SALLA_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: `${APP_URL}/auth/callback`,
        code
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.tokenExpiry = Date.now() + expires_in * 1000;

    res.redirect('/pages/upload.html');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/pages/error.html?msg=' + encodeURIComponent('حدث خطأ أثناء تسجيل الدخول.'));
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  if (!req.session.refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  try {
    const tokenResponse = await axios.post(
      SALLA_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: req.session.refreshToken
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.tokenExpiry = Date.now() + expires_in * 1000;

    res.json({ success: true });
  } catch (err) {
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
});

// Check auth status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken,
    tokenExpiry: req.session.tokenExpiry
  });
});

module.exports = router;
