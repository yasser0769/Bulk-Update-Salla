const express = require('express');
const axios = require('axios');
const router = express.Router();

const { getDB } = require('../services/database');
const { getMerchantInfo } = require('../services/salla');

const SALLA_OAUTH_URL = process.env.SALLA_OAUTH_URL || 'https://accounts.salla.sa/oauth2/auth';
const SALLA_TOKEN_URL = process.env.SALLA_TOKEN_URL || 'https://accounts.salla.sa/oauth2/token';
const SALLA_EXCHANGE_INTROSPECT_URL = process.env.SALLA_EXCHANGE_INTROSPECT_URL || 'https://api.salla.dev/exchange-authority/v1/introspect';
const CLIENT_ID = process.env.SALLA_CLIENT_ID;
const CLIENT_SECRET = process.env.SALLA_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const FALLBACK_APP_ID = process.env.SALLA_APP_ID || '';

function saveSessionTokens(req, { accessToken, refreshToken, tokenExpiry, merchantId }) {
  req.session.accessToken = accessToken;
  req.session.refreshToken = refreshToken;
  req.session.tokenExpiry = tokenExpiry;
  if (merchantId) {
    req.session.merchantId = String(merchantId);
  }
}

function upsertMerchantTokens(merchantId, accessToken, refreshToken, tokenExpiry) {
  if (!merchantId) return;

  const db = getDB();
  db.prepare(`
    INSERT INTO merchant_tokens (merchant_id, access_token, refresh_token, token_expiry)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(merchant_id) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      token_expiry = excluded.token_expiry,
      updated_at = CURRENT_TIMESTAMP
  `).run(String(merchantId), accessToken, refreshToken || null, tokenExpiry || null);
}

async function resolveMerchantId(accessToken) {
  try {
    const merchant = await getMerchantInfo(accessToken);
    const merchantId = merchant?.id || merchant?.merchant_id || null;
    return merchantId ? String(merchantId) : null;
  } catch (err) {
    console.warn('Failed to resolve merchant id from access token:', err.message);
    return null;
  }
}

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
    const tokenExpiry = Date.now() + expires_in * 1000;
    const merchantId = await resolveMerchantId(access_token);

    saveSessionTokens(req, {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry,
      merchantId
    });
    upsertMerchantTokens(merchantId, access_token, refresh_token, tokenExpiry);

    res.redirect('/pages/upload.html');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/pages/error.html?msg=' + encodeURIComponent('حدث خطأ أثناء تسجيل الدخول.'));
  }
});

// Embedded auth verification via exchange authority token introspection
router.post('/embedded/verify', async (req, res) => {
  const token = req.body?.token;
  const appId = req.body?.appId || req.body?.app_id || FALLBACK_APP_ID;

  if (!token) {
    return res.status(400).json({ error: 'Embedded token is required.' });
  }

  if (!appId) {
    return res.status(400).json({
      error: 'App ID is required for embedded introspection. Set SALLA_APP_ID in environment.'
    });
  }

  try {
    const introspectResponse = await axios.post(
      SALLA_EXCHANGE_INTROSPECT_URL,
      { token },
      {
        headers: {
          'Content-Type': 'application/json',
          's-source': String(appId)
        }
      }
    );

    const data = introspectResponse.data?.data || {};
    const merchantId = data.merchant_id ? String(data.merchant_id) : null;
    if (!merchantId) {
      return res.status(401).json({ error: 'Invalid embedded token.' });
    }

    req.session.embedded = {
      appId: String(appId),
      merchantId,
      userId: data.user_id ? String(data.user_id) : null,
      exp: data.exp || null
    };

    const db = getDB();
    const stored = db.prepare(`
      SELECT access_token, refresh_token, token_expiry
      FROM merchant_tokens
      WHERE merchant_id = ?
    `).get(merchantId);

    if (stored?.access_token) {
      saveSessionTokens(req, {
        accessToken: stored.access_token,
        refreshToken: stored.refresh_token || null,
        tokenExpiry: stored.token_expiry || null,
        merchantId
      });
    }

    res.json({
      success: true,
      merchantId,
      userId: data.user_id ? String(data.user_id) : null,
      authenticated: !!req.session.accessToken,
      hasStoredToken: !!stored?.access_token
    });
  } catch (err) {
    console.error('Embedded verify error:', err.response?.data || err.message);
    res.status(401).json({ error: 'Failed to verify embedded token.' });
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
    const tokenExpiry = Date.now() + expires_in * 1000;
    const merchantId = req.session.merchantId || await resolveMerchantId(access_token);

    saveSessionTokens(req, {
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry,
      merchantId
    });
    upsertMerchantTokens(merchantId, access_token, refresh_token, tokenExpiry);

    res.json({ success: true });
  } catch (err) {
    console.error('Refresh token error:', err.response?.data || err.message);
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
    tokenExpiry: req.session.tokenExpiry,
    merchantId: req.session.merchantId || req.session.embedded?.merchantId || null,
    embedded: !!req.session.embedded
  });
});

module.exports = router;
