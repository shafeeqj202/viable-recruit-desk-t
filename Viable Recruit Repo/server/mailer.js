const nodemailer = require('nodemailer');

// Sends via the team's own Gmail account using an "App Password" (not the
// regular login password) — generated under Google Account > Security >
// 2-Step Verification > App Passwords. Configure via env vars:
//   GMAIL_USER          the Gmail address to send from
//   GMAIL_APP_PASSWORD  the 16-character app password
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

let transporter = null;
function getTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
  }
  return transporter;
}

// Returns true if an email was actually sent, false if mail isn't configured
// (callers should still respond to the user as if it worked, to avoid
// leaking whether an email address has an account).
async function sendPasswordResetEmail(toEmail, resetUrl) {
  const t = getTransporter();
  if (!t) {
    console.error('Password reset email NOT sent — GMAIL_USER/GMAIL_APP_PASSWORD are not configured on this server.');
    return false;
  }
  await t.sendMail({
    from: 'Viable Recruit Desk <' + GMAIL_USER + '>',
    to: toEmail,
    subject: 'Reset your Viable Recruit Desk password',
    text:
      'Someone (hopefully you) asked to reset the password for this account.\n\n' +
      'Reset your password: ' + resetUrl + '\n\n' +
      'This link works once and expires in 1 hour. If you didn’t request this, you can ignore this email — your password won’t change.',
    html:
      '<p>Someone (hopefully you) asked to reset the password for this account.</p>' +
      '<p><a href="' + resetUrl + '">Reset your password</a></p>' +
      '<p style="color:#666;font-size:13px;">This link works once and expires in 1 hour. If you didn’t request this, you can ignore this email — your password won’t change.</p>',
  });
  return true;
}

module.exports = { sendPasswordResetEmail };
