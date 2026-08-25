const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

const router = express.Router();

const INVITE_CODE = process.env.TEAM_INVITE_CODE || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  pool.query('SELECT id, name, email FROM users WHERE id = $1', [req.session.userId])
    .then((r) => res.json({ user: r.rows[0] ? publicUser(r.rows[0]) : null }))
    .catch(() => res.json({ user: null }));
});

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, inviteCode } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!email || !EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'A valid email is required.' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (!INVITE_CODE) return res.status(500).json({ error: 'Sign-up is not configured on this server.' });
    if (String(inviteCode || '') !== INVITE_CODE) return res.status(403).json({ error: 'That team invite code is not correct.' });

    const emailNorm = String(email).trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [emailNorm]);
    if (existing.rows.length) return res.status(409).json({ error: 'An account with that email already exists — try logging in instead.' });

    const hash = await bcrypt.hash(String(password), 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [String(name).trim(), emailNorm, hash]
    );
    req.session.userId = result.rows[0].id;
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Could not create the account. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const emailNorm = String(email).trim().toLowerCase();
    const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [emailNorm]);
    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: 'Incorrect email or password.' });
    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });
    req.session.userId = row.id;
    res.json({ user: publicUser(row) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('vrd.sid');
    res.json({ ok: true });
  });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_authenticated' });
  next();
}

module.exports = { router, requireAuth };
