const express = require('express');
const multer = require('multer');
const { pool, nextSeq, bumpSeqIfHigher } = require('../db');
const { requireAuth } = require('./auth');
const {
  JOB_STATUSES, CANDIDATE_STATUS_KEYS, STATUS_FLOW, RESUME_MAX_BYTES,
} = require('../constants');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: RESUME_MAX_BYTES },
});

function pad4(n) { return String(n).padStart(4, '0'); }

function jobRowToApi(r) {
  return {
    id: r.id, title: r.title, skills: r.skills, client: r.client, partner: r.partner,
    location: r.location, workRights: r.work_rights, engagementType: r.engagement_type,
    locationType: r.location_type, startDate: r.start_date, duration: r.duration,
    onshoreRate: r.onshore_rate, offshoreRate: r.offshore_rate, description: r.description,
    status: r.status, createdAt: r.created_at,
  };
}

function candidateRowToApi(r) {
  return {
    id: r.id, jobId: r.job_id, name: r.name, workRights: r.work_rights, location: r.location,
    availability: r.availability, cost: r.cost, billingRate: r.billing_rate, notes: r.notes,
    status: r.status,
    resume: r.resume_name ? { name: r.resume_name, type: r.resume_type, size: r.resume_size } : null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/* ---------------- combined state ---------------- */
router.get('/state', async (req, res) => {
  try {
    const [jobsR, candsR, histR] = await Promise.all([
      pool.query('SELECT * FROM jobs ORDER BY created_at DESC'),
      pool.query(`SELECT id, job_id, name, work_rights, location, availability, cost, billing_rate,
        notes, status, resume_name, resume_type, resume_size, created_at, updated_at
        FROM candidates ORDER BY created_at DESC`),
      pool.query('SELECT candidate_id, status, at FROM candidate_status_history ORDER BY at ASC'),
    ]);
    const historyByCand = {};
    histR.rows.forEach((h) => {
      (historyByCand[h.candidate_id] = historyByCand[h.candidate_id] || []).push({ status: h.status, at: h.at });
    });
    const candidates = candsR.rows.map((r) => Object.assign(candidateRowToApi(r), { statusHistory: historyByCand[r.id] || [] }));
    res.json({ jobs: jobsR.rows.map(jobRowToApi), candidates });
  } catch (err) {
    console.error('GET /state error', err);
    res.status(500).json({ error: 'Could not load the tracker.' });
  }
});

/* ---------------- jobs ---------------- */
router.post('/jobs', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const client = String(b.client || '').trim();
    const location = String(b.location || '').trim();
    const errors = {};
    if (!title) errors.title = 'Title is required.';
    if (!client) errors.client = 'Client is required.';
    if (!location) errors.location = 'Location is required.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const status = JOB_STATUSES.includes(b.status) ? b.status : 'Open';
    const seq = await nextSeq('job_seq');
    const id = 'JOB-' + pad4(seq);
    const r = await pool.query(
      `INSERT INTO jobs (id, title, skills, client, partner, location, work_rights, engagement_type,
        location_type, start_date, duration, onshore_rate, offshore_rate, description, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
      [id, title, String(b.skills || '').trim(), client, String(b.partner || '').trim(), location,
        String(b.workRights || ''), String(b.engagementType || ''), String(b.locationType || ''),
        String(b.startDate || ''), String(b.duration || '').trim(), String(b.onshoreRate || '').trim(),
        String(b.offshoreRate || '').trim(), String(b.description || '').trim(), status, req.session.userId]
    );
    res.json({ job: jobRowToApi(r.rows[0]) });
  } catch (err) {
    console.error('POST /jobs error', err);
    res.status(500).json({ error: 'Could not save the job.' });
  }
});

router.put('/jobs/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const client = String(b.client || '').trim();
    const location = String(b.location || '').trim();
    const errors = {};
    if (!title) errors.title = 'Title is required.';
    if (!client) errors.client = 'Client is required.';
    if (!location) errors.location = 'Location is required.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const status = JOB_STATUSES.includes(b.status) ? b.status : 'Open';
    const r = await pool.query(
      `UPDATE jobs SET title=$2, skills=$3, client=$4, partner=$5, location=$6, work_rights=$7,
        engagement_type=$8, location_type=$9, start_date=$10, duration=$11, onshore_rate=$12,
        offshore_rate=$13, description=$14, status=$15, updated_at=now(), updated_by=$16
       WHERE id=$1 RETURNING *`,
      [req.params.id, title, String(b.skills || '').trim(), client, String(b.partner || '').trim(), location,
        String(b.workRights || ''), String(b.engagementType || ''), String(b.locationType || ''),
        String(b.startDate || ''), String(b.duration || '').trim(), String(b.onshoreRate || '').trim(),
        String(b.offshoreRate || '').trim(), String(b.description || '').trim(), status, req.session.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    res.json({ job: jobRowToApi(r.rows[0]) });
  } catch (err) {
    console.error('PUT /jobs/:id error', err);
    res.status(500).json({ error: 'Could not save the job.' });
  }
});

router.put('/jobs/:id/status', async (req, res) => {
  try {
    const status = req.body && req.body.status;
    if (!JOB_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const r = await pool.query(
      `UPDATE jobs SET status=$2, updated_at=now(), updated_by=$3 WHERE id=$1 RETURNING *`,
      [req.params.id, status, req.session.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Job not found.' });
    res.json({ job: jobRowToApi(r.rows[0]) });
  } catch (err) {
    console.error('PUT /jobs/:id/status error', err);
    res.status(500).json({ error: 'Could not update the job status.' });
  }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    const countR = await pool.query('SELECT count(*)::int AS n FROM candidates WHERE job_id = $1', [req.params.id]);
    if (countR.rows[0].n > 0) return res.status(409).json({ error: 'Reassign or remove candidates before deleting this job.' });
    await pool.query('DELETE FROM jobs WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /jobs/:id error', err);
    res.status(500).json({ error: 'Could not delete the job.' });
  }
});

/* ---------------- candidates ---------------- */
router.post('/candidates', upload.single('resume'), async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const jobId = String(b.jobId || '').trim();
    const location = String(b.location || '').trim();
    const cost = String(b.cost || '').trim();
    const errors = {};
    if (!name) errors.name = 'Name is required.';
    if (!jobId) errors.jobId = 'Select a job.';
    if (!location) errors.location = 'Location is required.';
    if (!cost) errors.cost = 'Cost is required.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const jobR = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (!jobR.rows[0]) return res.status(400).json({ errors: { jobId: 'Select a valid job.' } });

    const seq = await nextSeq('candidate_seq');
    const id = 'CAND-' + pad4(seq);
    const f = req.file;
    const r = await pool.query(
      `INSERT INTO candidates (id, job_id, name, work_rights, location, availability, cost, billing_rate,
        notes, status, resume_name, resume_type, resume_size, resume_data, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Shortlisted',$10,$11,$12,$13,$14,$14) RETURNING *`,
      [id, jobId, name, String(b.workRights || ''), location, String(b.availability || '').trim(), cost,
        String(b.billingRate || '').trim(), String(b.notes || '').trim(),
        f ? f.originalname : null, f ? f.mimetype : null, f ? f.size : null, f ? f.buffer : null,
        req.session.userId]
    );
    await pool.query(
      'INSERT INTO candidate_status_history (candidate_id, status, changed_by) VALUES ($1,$2,$3)',
      [id, 'Shortlisted', req.session.userId]
    );
    res.json({ candidate: Object.assign(candidateRowToApi(r.rows[0]), { statusHistory: [{ status: 'Shortlisted', at: r.rows[0].created_at }] }) });
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That resume is too large (max ' + Math.round(RESUME_MAX_BYTES / 1024 / 1024) + ' MB).' });
    console.error('POST /candidates error', err);
    res.status(500).json({ error: 'Could not save the candidate.' });
  }
});

router.put('/candidates/:id', upload.single('resume'), async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    const jobId = String(b.jobId || '').trim();
    const location = String(b.location || '').trim();
    const cost = String(b.cost || '').trim();
    const errors = {};
    if (!name) errors.name = 'Name is required.';
    if (!jobId) errors.jobId = 'Select a job.';
    if (!location) errors.location = 'Location is required.';
    if (!cost) errors.cost = 'Cost is required.';
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    const f = req.file;
    const removeResume = String(b.removeResume || '') === '1';

    let sql, params;
    if (f) {
      sql = `UPDATE candidates SET job_id=$2, name=$3, work_rights=$4, location=$5, availability=$6,
        cost=$7, billing_rate=$8, notes=$9, resume_name=$10, resume_type=$11, resume_size=$12,
        resume_data=$13, updated_at=now(), updated_by=$14 WHERE id=$1 RETURNING *`;
      params = [req.params.id, jobId, name, String(b.workRights || ''), location, String(b.availability || '').trim(),
        cost, String(b.billingRate || '').trim(), String(b.notes || '').trim(),
        f.originalname, f.mimetype, f.size, f.buffer, req.session.userId];
    } else if (removeResume) {
      sql = `UPDATE candidates SET job_id=$2, name=$3, work_rights=$4, location=$5, availability=$6,
        cost=$7, billing_rate=$8, notes=$9, resume_name=NULL, resume_type=NULL, resume_size=NULL,
        resume_data=NULL, updated_at=now(), updated_by=$10 WHERE id=$1 RETURNING *`;
      params = [req.params.id, jobId, name, String(b.workRights || ''), location, String(b.availability || '').trim(),
        cost, String(b.billingRate || '').trim(), String(b.notes || '').trim(), req.session.userId];
    } else {
      sql = `UPDATE candidates SET job_id=$2, name=$3, work_rights=$4, location=$5, availability=$6,
        cost=$7, billing_rate=$8, notes=$9, updated_at=now(), updated_by=$10 WHERE id=$1 RETURNING *`;
      params = [req.params.id, jobId, name, String(b.workRights || ''), location, String(b.availability || '').trim(),
        cost, String(b.billingRate || '').trim(), String(b.notes || '').trim(), req.session.userId];
    }
    const r = await pool.query(sql, params);
    if (!r.rows[0]) return res.status(404).json({ error: 'Candidate not found.' });
    res.json({ candidate: candidateRowToApi(r.rows[0]) });
  } catch (err) {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That resume is too large (max ' + Math.round(RESUME_MAX_BYTES / 1024 / 1024) + ' MB).' });
    console.error('PUT /candidates/:id error', err);
    res.status(500).json({ error: 'Could not save the candidate.' });
  }
});

router.put('/candidates/:id/status', async (req, res) => {
  try {
    const to = req.body && req.body.to;
    const force = req.body && req.body.force === true;
    if (!CANDIDATE_STATUS_KEYS.includes(to)) return res.status(400).json({ error: 'Invalid status.' });

    const curR = await pool.query('SELECT status FROM candidates WHERE id = $1', [req.params.id]);
    if (!curR.rows[0]) return res.status(404).json({ error: 'Candidate not found.' });
    const from = curR.rows[0].status;

    if (!force) {
      const allowed = STATUS_FLOW[from] || [];
      if (!allowed.includes(to)) {
        return res.status(409).json({ error: from + ' can’t move directly to ' + to + '. Use the override option to bypass the guided sequence.' });
      }
    }

    const r = await pool.query(
      'UPDATE candidates SET status=$2, updated_at=now(), updated_by=$3 WHERE id=$1 RETURNING *',
      [req.params.id, to, req.session.userId]
    );
    await pool.query(
      'INSERT INTO candidate_status_history (candidate_id, status, changed_by) VALUES ($1,$2,$3)',
      [req.params.id, to, req.session.userId]
    );
    res.json({ candidate: candidateRowToApi(r.rows[0]) });
  } catch (err) {
    console.error('PUT /candidates/:id/status error', err);
    res.status(500).json({ error: 'Could not update the candidate status.' });
  }
});

router.delete('/candidates/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM candidates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /candidates/:id error', err);
    res.status(500).json({ error: 'Could not delete the candidate.' });
  }
});

router.get('/candidates/:id/resume', async (req, res) => {
  try {
    const r = await pool.query('SELECT resume_name, resume_type, resume_data FROM candidates WHERE id = $1', [req.params.id]);
    const row = r.rows[0];
    if (!row || !row.resume_data) return res.status(404).send('No resume on file.');
    res.setHeader('Content-Type', row.resume_type || 'application/octet-stream');
    const disposition = row.resume_type === 'application/pdf' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', disposition + '; filename="' + String(row.resume_name || 'resume').replace(/"/g, '') + '"');
    res.send(row.resume_data);
  } catch (err) {
    console.error('GET /candidates/:id/resume error', err);
    res.status(500).send('Could not load the resume.');
  }
});

/* ---------------- export / import ---------------- */
router.get('/export', async (req, res) => {
  try {
    const [jobsR, candsR, histR] = await Promise.all([
      pool.query('SELECT * FROM jobs ORDER BY created_at ASC'),
      pool.query(`SELECT id, job_id, name, work_rights, location, availability, cost, billing_rate,
        notes, status, resume_name, resume_type, resume_size, created_at, updated_at
        FROM candidates ORDER BY created_at ASC`),
      pool.query('SELECT candidate_id, status, at FROM candidate_status_history ORDER BY at ASC'),
    ]);
    const historyByCand = {};
    histR.rows.forEach((h) => {
      (historyByCand[h.candidate_id] = historyByCand[h.candidate_id] || []).push({ status: h.status, at: h.at });
    });
    const candidates = candsR.rows.map((r) => Object.assign(candidateRowToApi(r), { statusHistory: historyByCand[r.id] || [] }));
    res.setHeader('Content-Disposition', 'attachment; filename="viable-recruit-desk-backup.json"');
    res.json({ exportedAt: new Date().toISOString(), jobs: jobsR.rows.map(jobRowToApi), candidates });
  } catch (err) {
    console.error('GET /export error', err);
    res.status(500).json({ error: 'Could not export data.' });
  }
});

router.post('/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    if (!Array.isArray(body.jobs) || !Array.isArray(body.candidates)) {
      return res.status(400).json({ error: 'That file doesn’t look like a Viable Recruit Desk backup.' });
    }
    await client.query('BEGIN');
    await client.query('DELETE FROM candidate_status_history');
    await client.query('DELETE FROM candidates');
    await client.query('DELETE FROM jobs');
    let maxJob = 0, maxCand = 0;
    for (const j of body.jobs) {
      await client.query(
        `INSERT INTO jobs (id, title, skills, client, partner, location, work_rights, engagement_type,
          location_type, start_date, duration, onshore_rate, offshore_rate, description, status, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
        [j.id, j.title || '', j.skills || '', j.client || '', j.partner || '', j.location || '',
          j.workRights || '', j.engagementType || '', j.locationType || '', j.startDate || '',
          j.duration || '', j.onshoreRate || '', j.offshoreRate || '', j.description || '',
          JOB_STATUSES.includes(j.status) ? j.status : 'Open', req.session.userId]
      );
      const m = /^JOB-(\d+)$/.exec(j.id || '');
      if (m) maxJob = Math.max(maxJob, parseInt(m[1], 10));
    }
    for (const c of body.candidates) {
      // Support both the current API export shape and the older single-file
      // artifact's backup shape, which embedded the resume as a base64 dataUrl.
      let resumeName = null, resumeType = null, resumeSize = null, resumeData = null;
      if (c.resume && c.resume.dataUrl) {
        const m = /^data:([^;]+);base64,(.*)$/.exec(c.resume.dataUrl);
        if (m) {
          resumeName = c.resume.name || 'resume';
          resumeType = c.resume.type || m[1];
          resumeData = Buffer.from(m[2], 'base64');
          resumeSize = c.resume.size || resumeData.length;
        }
      }
      await client.query(
        `INSERT INTO candidates (id, job_id, name, work_rights, location, availability, cost, billing_rate,
          notes, status, resume_name, resume_type, resume_size, resume_data, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
        [c.id, c.jobId || null, c.name || '', c.workRights || '', c.location || '', c.availability || '',
          c.cost || '', c.billingRate || '', c.notes || '',
          CANDIDATE_STATUS_KEYS.includes(c.status) ? c.status : 'Shortlisted',
          resumeName, resumeType, resumeSize, resumeData, req.session.userId]
      );
      const hist = Array.isArray(c.statusHistory) && c.statusHistory.length ? c.statusHistory : [{ status: c.status || 'Shortlisted', at: c.createdAt || new Date().toISOString() }];
      for (const h of hist) {
        await client.query(
          'INSERT INTO candidate_status_history (candidate_id, status, at, changed_by) VALUES ($1,$2,$3,$4)',
          [c.id, h.status, h.at || new Date().toISOString(), req.session.userId]
        );
      }
      const m = /^CAND-(\d+)$/.exec(c.id || '');
      if (m) maxCand = Math.max(maxCand, parseInt(m[1], 10));
    }
    await client.query('COMMIT');
    await bumpSeqIfHigher('job_seq', maxJob + 1);
    await bumpSeqIfHigher('candidate_seq', maxCand + 1);
    res.json({ ok: true, jobs: body.jobs.length, candidates: body.candidates.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /import error', err);
    res.status(500).json({ error: 'Could not import that backup. Nothing was changed.' });
  } finally {
    client.release();
  }
});

module.exports = router;
