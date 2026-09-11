/* Viable Recruit Desk — client app. Talks to the REST API in server/routes/. */
(function(){
'use strict';

/* ---------- constants (mirrors server/constants.js) ---------- */
var JOB_STATUSES = ['Open','On Hold','Closed'];
var JOB_STATUS_CLASS = {'Open':'stage-good','On Hold':'stage-warn','Closed':'stage-neutral'};
var JOB_PRIORITIES = ['Low','Medium','High','Very High'];
var JOB_PRIORITY_CLASS = {'Low':'stage-neutral','Medium':'stage-active','High':'stage-warn','Very High':'stage-bad'};
var WORK_RIGHTS_OPTIONS = ['Citizen','Permanent Resident','Work Visa (no sponsorship needed)','Requires Sponsorship','Any / Unspecified'];
var ENGAGEMENT_TYPES = ['Contract','Permanent'];
var LOCATION_TYPES = ['Onshore','Offshore'];
var LOCATION_TYPE_CLASS = {'Onshore':'stage-active','Offshore':'stage-neutral'};
var RESUME_MAX_BYTES = 3*1024*1024;

var CANDIDATE_STATUSES = [
  {key:'Shortlisted', cls:'stage-neutral'},
  {key:'Screened', cls:'stage-active'},
  {key:'Screen Reject', cls:'stage-bad'},
  {key:'L1 Select', cls:'stage-active'},
  {key:'L1 Reject', cls:'stage-bad'},
  {key:'L2 Select', cls:'stage-active'},
  {key:'L2 Reject', cls:'stage-bad'},
  {key:'Client Interview Scheduled', cls:'stage-active'},
  {key:'Client Select', cls:'stage-active'},
  {key:'Client Reject', cls:'stage-bad'},
  {key:'Selected', cls:'stage-active'},
  {key:'Offered', cls:'stage-active'},
  {key:'Onboarded', cls:'stage-good'}
];
var STATUS_ABBR = {'Shortlisted':'SH','Screened':'SC','Screen Reject':'SR','L1 Select':'L1S','L1 Reject':'L1R','L2 Select':'L2S','L2 Reject':'L2R','Client Interview Scheduled':'CIS','Client Select':'CS','Client Reject':'CR','Selected':'SEL','Offered':'OFF','Onboarded':'ONB'};
var STATUS_CLASS = {};
CANDIDATE_STATUSES.forEach(function(s){ STATUS_CLASS[s.key] = s.cls; });

var STATUS_FLOW = {
  'Shortlisted':['Screened','Screen Reject'],
  'Screened':['L1 Select','L1 Reject'],
  'Screen Reject':[],
  'L1 Select':['L2 Select','L2 Reject'],
  'L1 Reject':[],
  'L2 Select':['Client Interview Scheduled'],
  'L2 Reject':[],
  'Client Interview Scheduled':['Client Select','Client Reject'],
  'Client Select':['Selected'],
  'Client Reject':[],
  'Selected':['Offered'],
  'Offered':['Onboarded'],
  'Onboarded':[]
};
var TERMINAL_STATUSES = {'Screen Reject':1,'L1 Reject':1,'L2 Reject':1,'Client Reject':1,'Onboarded':1};
var ACTION_LABEL = {
  'Shortlisted>Screened':'Mark Screened',
  'Shortlisted>Screen Reject':'Reject at Screening',
  'Screened>L1 Select':'Pass L1',
  'Screened>L1 Reject':'Reject at L1',
  'L1 Select>L2 Select':'Pass L2',
  'L1 Select>L2 Reject':'Reject at L2',
  'L2 Select>Client Interview Scheduled':'Schedule Client Interview',
  'Client Interview Scheduled>Client Select':'Client Selected',
  'Client Interview Scheduled>Client Reject':'Client Rejected',
  'Client Select>Selected':'Confirm Selected',
  'Selected>Offered':'Extend Offer',
  'Offered>Onboarded':'Confirm Onboarded'
};

/* ---------- helpers ---------- */
function esc(v){
  if(v===undefined||v===null) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(iso){
  if(!iso) return '—';
  var d=new Date(iso);
  if(isNaN(d.getTime())) return '—';
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate()+' '+months[d.getMonth()]+' '+d.getFullYear();
}
function fmtDateOnly(ymd){
  if(!ymd) return '—';
  var parts = String(ymd).split('-');
  if(parts.length!==3) return fmtDate(ymd);
  var y=+parts[0], m=+parts[1]-1, d=+parts[2];
  var dt = new Date(y,m,d);
  if(isNaN(dt.getTime())) return '—';
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return dt.getDate()+' '+months[dt.getMonth()]+' '+dt.getFullYear();
}
function fmtBytes(n){
  if(n===undefined||n===null||isNaN(n)) return '';
  if(n < 1024) return n+' B';
  if(n < 1024*1024) return (n/1024).toFixed(0)+' KB';
  return (n/1024/1024).toFixed(1)+' MB';
}
function skillsArr(s){ return (s||'').split(',').map(function(x){return x.trim();}).filter(Boolean); }
function jobById(st,id){ for(var i=0;i<st.jobs.length;i++){ if(st.jobs[i].id===id) return st.jobs[i]; } return null; }
function candidateById(st,id){ for(var i=0;i<st.candidates.length;i++){ if(st.candidates[i].id===id) return st.candidates[i]; } return null; }
function candidatesForJob(st,jobId){ return st.candidates.filter(function(c){return c.jobId===jobId;}); }
function fdToObj(fd, keys){ var o={}; keys.forEach(function(k){o[k]=(fd.get(k)||'').toString();}); return o; }
function initials(name){
  var parts = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  return (parts[0][0]+(parts[1]?parts[1][0]:'')).toUpperCase();
}
function isChecked(v){ return v===true || v==='1' || v==='on'; }

/* ---------- state ---------- */
var state = { jobs: [], candidates: [] };
var user = null; /* {id,name,email} once logged in */

var ui = {
  loading: true,
  authMode: 'login', /* 'login' | 'signup' */
  authError: '',
  authBusy: false,
  tab: 'dashboard',
  jobsSearch:'', jobsStatusFilter:'All',
  candSearch:'', candStatusFilter:'All', candJobFilter:'All',
  dashJobStatusFilter:'All', dashLocationFilter:'All', dashPartnerFilter:'All', dashCandStatusFilter:'All', dashPriorityFilter:'All',
  jobModal:null,      /* {mode:'new'|'edit', jobId, formValues} */
  candModal:null,     /* {mode:'new'|'edit', candidateId, presetJobId, formValues, resumeFile, removeResume} */
  drilldown:null,     /* {jobId, status|'__total__'} */
  confirm:null,       /* {title, message, confirmLabel, danger, onYes} */
  resumePreview:null, /* {name, size, url} */
  backupOpen:false,
  overrideOpenFor:null,
  saving:false,
  fieldErrors:{}
};
(function restoreUiFromSession(){
  try{
    var raw = sessionStorage.getItem('vrd_ui');
    if(raw){
      var saved = JSON.parse(raw);
      ['tab','jobsSearch','jobsStatusFilter','candSearch','candStatusFilter','candJobFilter','dashJobStatusFilter','dashLocationFilter','dashPartnerFilter','dashCandStatusFilter','dashPriorityFilter'].forEach(function(k){
        if(saved[k]!==undefined) ui[k]=saved[k];
      });
    }
  }catch(e){}
})();
function persistUiToSession(){
  try{
    sessionStorage.setItem('vrd_ui', JSON.stringify({
      tab:ui.tab, jobsSearch:ui.jobsSearch, jobsStatusFilter:ui.jobsStatusFilter,
      candSearch:ui.candSearch, candStatusFilter:ui.candStatusFilter, candJobFilter:ui.candJobFilter,
      dashJobStatusFilter:ui.dashJobStatusFilter, dashLocationFilter:ui.dashLocationFilter,
      dashPartnerFilter:ui.dashPartnerFilter, dashCandStatusFilter:ui.dashCandStatusFilter,
      dashPriorityFilter:ui.dashPriorityFilter
    }));
  }catch(e){}
}
function getCandidateModalResumeMeta(){
  if(!ui.candModal) return null;
  if(ui.candModal.removeResume) return null;
  if(ui.candModal.resumeFile) return {name:ui.candModal.resumeFile.name, size:ui.candModal.resumeFile.size, type:ui.candModal.resumeFile.type};
  var c = candidateById(state, ui.candModal.candidateId);
  return c ? (c.resume||null) : null;
}
function isPdfResume(meta){ return !!meta && (meta.type==='application/pdf' || /\.pdf$/i.test(meta.name||'')); }

/* ---------- toasts + saving overlay ---------- */
function pushToast(msg, kind){
  var host = document.getElementById('toast-root');
  if(!host) return;
  var el = document.createElement('div');
  el.className = 'toast' + (kind==='bad' ? ' bad' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, 4200);
}
function showSaving(){
  if(document.getElementById('saving-overlay-el')) return;
  var d = document.createElement('div');
  d.id = 'saving-overlay-el';
  d.className = 'saving-overlay';
  d.setAttribute('aria-hidden','true');
  document.body.appendChild(d);
}
function hideSaving(){
  var d = document.getElementById('saving-overlay-el');
  if(d && d.parentNode) d.parentNode.removeChild(d);
}

/* ---------- API layer ---------- */
function api(method, url, body, isForm){
  var opts = { method: method, credentials: 'same-origin', headers: {} };
  if(body!==undefined){
    if(isForm){ opts.body = body; }
    else { opts.headers['Content-Type']='application/json'; opts.body = JSON.stringify(body); }
  }
  return fetch(url, opts).then(function(res){
    if(res.status===401){
      user = null; ui.loading=false; renderApp();
      throw {code:'not_authenticated'};
    }
    var ct = res.headers.get('content-type')||'';
    var parse = ct.indexOf('application/json')>-1 ? res.json() : res.text();
    return parse.then(function(data){
      if(!res.ok){ var e = new Error((data&&data.error)||'Request failed'); e.data=data; e.status=res.status; throw e; }
      return data;
    });
  });
}

function loadState(){
  return api('GET','/api/state').then(function(data){
    state.jobs = data.jobs; state.candidates = data.candidates;
  });
}

/* mutation wrapper: runs the api call, then reloads state, re-renders, and
   invokes onSuccess. Mirrors the shape of the old artifact's mutateAndPublish
   so the rest of the render code barely changed. */
function runMutation(promiseFactory, opts){
  opts = opts || {};
  showSaving();
  promiseFactory().then(function(result){
    return loadState().then(function(){
      hideSaving();
      if(opts.onSuccess) opts.onSuccess(result);
      renderApp();
    });
  }).catch(function(err){
    hideSaving();
    if(err && err.code==='not_authenticated') return;
    if(err && err.data && err.data.errors){
      ui.fieldErrors = err.data.errors;
      renderApp();
      return;
    }
    pushToast((err && err.message) || 'Something went wrong. Please try again.', 'bad');
    renderApp();
  });
}

/* ---------- render: app shell ---------- */
function renderApp(){
  persistUiToSession();
  var root = document.getElementById('root');
  if(ui.loading){ root.innerHTML = ''; return; }
  if(!user){ root.innerHTML = renderAuthScreen(); return; }
  var html = '';
  html += renderTopbar();
  if(ui.tab==='dashboard') html += renderDashboard();
  else if(ui.tab==='jobs') html += renderJobsView();
  else html += renderCandidatesView();
  if(ui.jobModal) html += renderJobModal();
  if(ui.candModal) html += renderCandidateModal();
  if(ui.drilldown) html += renderDrawer();
  if(ui.resumePreview) html += renderResumePreview();
  if(ui.backupOpen) html += renderBackupModal();
  if(ui.confirm) html += renderConfirmModal();
  root.innerHTML = html;
}

function askConfirm(opts){ ui.confirm = opts; renderApp(); }

function renderConfirmModal(){
  var c = ui.confirm;
  return '<div class="overlay" data-action="confirm-overlay-close">'+
    '<div class="modal" data-stop="1" style="max-width:420px;">'+
      '<h2>'+esc(c.title||'Please confirm')+'</h2>'+
      '<p class="modal-sub" style="margin-top:8px;margin-bottom:0;">'+esc(c.message)+'</p>'+
      '<div class="modal-footer">'+
        '<button type="button" class="btn btn-ghost" data-action="confirm-no">Cancel</button>'+
        '<button type="button" class="btn '+(c.danger?'btn-danger':'btn-primary')+'" data-action="confirm-yes">'+esc(c.confirmLabel||'Confirm')+'</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

function renderResumePreview(){
  var r = ui.resumePreview;
  var pdf = isPdfResume(r);
  return '<div class="overlay" data-action="resume-preview-overlay-close">'+
    '<div class="modal" data-stop="1" style="max-width:820px;">'+
      '<div class="modal-head"><div><h2>'+esc(r.name)+'</h2><div class="modal-sub">'+fmtBytes(r.size)+'</div></div>'+
        '<button class="btn btn-ghost btn-sm" data-action="close-resume-preview" aria-label="Close">✕</button></div>'+
      (pdf ? '<iframe src="'+esc(r.url)+'" style="width:100%;height:70vh;border:1px solid var(--border);border-radius:var(--radius-md);"></iframe>'
           : '<p class="modal-sub">This file type can’t be previewed inline here, but it’s attached to the candidate record.</p>')+
    '</div>'+
  '</div>';
}

function renderBackupModal(){
  return '<div class="overlay" data-action="backup-overlay-close">'+
    '<div class="modal" data-stop="1" style="max-width:560px;">'+
      '<div class="modal-head"><div><h2>Backup &amp; Restore</h2><div class="modal-sub">'+state.jobs.length+' job'+(state.jobs.length===1?'':'s')+' · '+state.candidates.length+' candidate'+(state.candidates.length===1?'':'s')+' currently in the tracker</div></div>'+
        '<button class="btn btn-ghost btn-sm" data-action="close-backup-modal" aria-label="Close">✕</button></div>'+
      '<div class="field">'+
        '<label>Export current data</label>'+
        '<div class="hint" style="margin:0 0 8px;">Downloads a JSON file with every job and candidate — resumes are not included in this file.</div>'+
        '<a class="btn btn-ghost btn-sm" href="/api/export" download="viable-recruit-desk-backup.json">Download backup (.json)</a>'+
      '</div>'+
      '<div class="field" style="margin-top:18px;">'+
        '<label>Restore from backup</label>'+
        '<div class="hint" style="margin:0 0 8px;">Replaces everything currently in the tracker with a previously downloaded backup file. This can’t be undone.</div>'+
        '<input type="file" accept="application/json" data-action="import-file-select">'+
      '</div>'+
    '</div>'+
  '</div>';
}

function renderTopbar(){
  var tabs = [['dashboard','Dashboard'],['jobs','Jobs'],['candidates','Candidates']];
  var tabsHtml = tabs.map(function(t){
    return '<button class="tab" data-action="switch-tab" data-tab="'+t[0]+'" role="tab" aria-selected="'+(ui.tab===t[0]?'true':'false')+'">'+t[1]+'</button>';
  }).join('');
  return ''+
  '<header class="topbar">'+
    '<div class="brand"><span class="brand-mark">Viable Recruit Desk</span></div>'+
    '<nav class="tabs" role="tablist" aria-label="Sections">'+tabsHtml+'</nav>'+
    '<button class="btn btn-ghost btn-sm" data-action="open-backup-modal">Backup</button>'+
    '<div class="user-chip"><span class="avatar">'+esc(initials(user.name))+'</span><span>'+esc(user.name)+'</span></div>'+
    '<button class="btn btn-ghost btn-sm" data-action="logout">Log out</button>'+
  '</header>';
}

/* ---------- Dashboard ---------- */
function renderDashboard(){
  var jobs = state.jobs;
  var candidates = state.candidates;
  if(!jobs.length){
    return '<main class="view"><div class="card"><div class="empty-state"><h3>No job requirements yet</h3><p>Create your first requirement to start tracking candidates against it.</p><button class="btn btn-primary" data-action="open-job-modal">+ New Job</button></div></div></main>';
  }
  var openJobs = jobs.filter(function(j){return j.status==='Open';}).length;
  var onHold = jobs.filter(function(j){return j.status==='On Hold';}).length;
  var onboarded = candidates.filter(function(c){return c.status==='Onboarded';}).length;
  var rejected = candidates.filter(function(c){return TERMINAL_STATUSES[c.status] && c.status!=='Onboarded';}).length;
  var active = candidates.filter(function(c){return !TERMINAL_STATUSES[c.status];}).length;

  var filteredJobs = jobs.filter(function(j){
    var matchesStatus = ui.dashJobStatusFilter==='All' || j.status===ui.dashJobStatusFilter;
    var matchesLocation = ui.dashLocationFilter==='All' || j.locationType===ui.dashLocationFilter;
    var matchesPartner = ui.dashPartnerFilter==='All' || j.partner===ui.dashPartnerFilter;
    var matchesCandStatus = ui.dashCandStatusFilter==='All' || candidatesForJob(state,j.id).some(function(c){ return c.status===ui.dashCandStatusFilter; });
    var matchesPriority = ui.dashPriorityFilter==='All' || j.priority===ui.dashPriorityFilter;
    return matchesStatus && matchesLocation && matchesPartner && matchesCandStatus && matchesPriority;
  });

  var visibleStatuses = ui.dashCandStatusFilter==='All' ? CANDIDATE_STATUSES : CANDIDATE_STATUSES.filter(function(s){ return s.key===ui.dashCandStatusFilter; });

  var headCells = visibleStatuses.map(function(s){
    return '<th title="'+esc(s.key)+'">'+STATUS_ABBR[s.key]+'</th>';
  }).join('');

  var rows = filteredJobs.map(function(j){
    var jc = candidatesForJob(state,j.id);
    var cells = visibleStatuses.map(function(s){
      var n = jc.filter(function(c){return c.status===s.key;}).length;
      if(n===0) return '<td><span class="count-zero">–</span></td>';
      return '<td><button class="count-btn" data-action="drilldown" data-job="'+esc(j.id)+'" data-status="'+esc(s.key)+'">'+n+'</button></td>';
    }).join('');
    var total = jc.length;
    return '<tr>'+
      '<td class="job-col"><div class="job-title">'+esc(j.title)+' <span class="pill '+(JOB_PRIORITY_CLASS[j.priority]||'stage-neutral')+'" style="font-size:.68rem;">'+esc(j.priority||'–')+'</span></div><div class="job-meta">'+esc(j.id)+' · '+esc(j.client)+(j.locationType?' · '+esc(j.locationType):'')+'</div></td>'+
      cells+
      '<td class="total-col">'+(total>0 ? '<button class="count-btn" data-action="drilldown" data-job="'+esc(j.id)+'" data-status="__total__">'+total+'</button>' : '<span class="count-zero">–</span>')+'</td>'+
    '</tr>';
  }).join('');

  var filterOptions = ['All'].concat(JOB_STATUSES).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.dashJobStatusFilter===s?' selected':'')+'>'+esc(s==='All'?'All job statuses':s)+'</option>';
  }).join('');
  var locationOptions = ['All'].concat(LOCATION_TYPES).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.dashLocationFilter===s?' selected':'')+'>'+esc(s==='All'?'Onshore & Offshore':s)+'</option>';
  }).join('');
  var partnerList = Array.from(new Set(jobs.map(function(j){return j.partner;}).filter(Boolean))).sort();
  var partnerOptions = ['All'].concat(partnerList).map(function(p){
    return '<option value="'+esc(p)+'"'+(ui.dashPartnerFilter===p?' selected':'')+'>'+esc(p==='All'?'All partners':p)+'</option>';
  }).join('');
  var candStatusOptions = ['All'].concat(CANDIDATE_STATUSES.map(function(s){return s.key;})).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.dashCandStatusFilter===s?' selected':'')+'>'+esc(s==='All'?'All candidate statuses':s)+'</option>';
  }).join('');
  var priorityOptions = ['All'].concat(JOB_PRIORITIES).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.dashPriorityFilter===s?' selected':'')+'>'+esc(s==='All'?'All priorities':s)+'</option>';
  }).join('');

  var legend = visibleStatuses.map(function(s){ return STATUS_ABBR[s.key]+' '+s.key; }).join(' · ');

  return '<main class="view">'+
    '<div class="view-head"><div><h1>Dashboard</h1><p>Candidate counts by stage for every job requirement. Click a count to see who’s there.</p></div></div>'+
    '<div class="stat-grid">'+
      '<div class="stat-tile"><span class="num tabular">'+openJobs+'</span><span class="label">Open Jobs</span></div>'+
      '<div class="stat-tile"><span class="num tabular">'+onHold+'</span><span class="label">On Hold</span></div>'+
      '<div class="stat-tile"><span class="num tabular">'+active+'</span><span class="label">Active Candidates</span></div>'+
      '<div class="stat-tile"><span class="num tabular">'+onboarded+'</span><span class="label">Onboarded</span></div>'+
      '<div class="stat-tile"><span class="num tabular">'+rejected+'</span><span class="label">Rejected</span></div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="toolbar"><span class="muted" style="font-size:.82rem;">Filter</span>'+
        '<select data-action="dash-status-filter">'+filterOptions+'</select>'+
        '<select data-action="dash-location-filter">'+locationOptions+'</select>'+
        '<select data-action="dash-partner-filter">'+partnerOptions+'</select>'+
        '<select data-action="dash-cand-status-filter">'+candStatusOptions+'</select>'+
        '<select data-action="dash-priority-filter">'+priorityOptions+'</select>'+
      '</div>'+
      '<div class="matrix-legend">'+legend+'</div>'+
      '<div class="table-scroll"><table class="matrix"><thead><tr><th class="job-col">Job</th>'+headCells+'<th class="total-col">Total</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '</div>'+
  '</main>';
}

/* ---------- Jobs view ---------- */
function renderJobsView(){
  var jobs = state.jobs.slice().sort(function(a,b){ return (b.createdAt||'').localeCompare(a.createdAt||''); });
  var q = ui.jobsSearch.toLowerCase();
  jobs = jobs.filter(function(j){
    var matchesQ = !q || (j.title+' '+j.client+' '+j.skills).toLowerCase().indexOf(q)>-1;
    var matchesS = ui.jobsStatusFilter==='All' || j.status===ui.jobsStatusFilter;
    return matchesQ && matchesS;
  });
  var statusFilterOpts = ['All'].concat(JOB_STATUSES).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.jobsStatusFilter===s?' selected':'')+'>'+esc(s)+'</option>';
  }).join('');

  var rows = jobs.map(function(j){
    var count = candidatesForJob(state,j.id).length;
    var skillChips = skillsArr(j.skills).slice(0,4).map(function(s){return '<span class="chip">'+esc(s)+'</span>';}).join('');
    var moreSkills = skillsArr(j.skills).length>4 ? '<span class="chip">+'+(skillsArr(j.skills).length-4)+'</span>' : '';
    var jobStatusOpts = JOB_STATUSES.map(function(s){ return '<option value="'+esc(s)+'"'+(j.status===s?' selected':'')+'>'+esc(s)+'</option>'; }).join('');
    var deleteDisabled = count>0;
    return '<tr>'+
      '<td class="id-cell">'+esc(j.id)+'</td>'+
      '<td><strong>'+esc(j.title)+'</strong><div class="chips" style="margin-top:4px;">'+skillChips+moreSkills+'</div></td>'+
      '<td>'+esc(j.client)+(j.partner?'<div class="muted" style="font-size:.76rem;">via '+esc(j.partner)+'</div>':'')+'</td>'+
      '<td>'+esc(j.location)+'</td>'+
      '<td>'+esc(j.workRights)+'</td>'+
      '<td>'+esc(j.engagementType)+(j.engagementType==='Contract' && j.duration ? '<div class="muted" style="font-size:.76rem;">'+esc(j.duration)+'</div>' : '')+'</td>'+
      '<td><span class="pill '+(LOCATION_TYPE_CLASS[j.locationType]||'stage-neutral')+'">'+esc(j.locationType||'–')+'</span></td>'+
      '<td><span class="pill '+(JOB_PRIORITY_CLASS[j.priority]||'stage-neutral')+'">'+esc(j.priority||'–')+'</span></td>'+
      '<td>'+fmtDateOnly(j.startDate)+'</td>'+
      '<td class="tabular">'+esc(j.onshoreRate||'–')+' / '+esc(j.offshoreRate||'–')+'</td>'+
      '<td><select data-action="job-status-change" data-job="'+esc(j.id)+'">'+jobStatusOpts+'</select></td>'+
      '<td>'+(count>0 ? '<button class="count-btn" data-action="jump-candidates" data-job="'+esc(j.id)+'">'+count+'</button>' : '<span class="count-zero">0</span>')+'</td>'+
      '<td class="row-actions">'+
        '<button class="btn btn-ghost btn-sm" data-action="open-job-modal" data-job="'+esc(j.id)+'">Edit</button>'+
        '<button class="btn btn-danger btn-sm" data-action="delete-job" data-job="'+esc(j.id)+'" '+(deleteDisabled?'disabled title="Reassign or remove candidates first"':'')+'>Delete</button>'+
      '</td>'+
    '</tr>';
  }).join('');

  var body = jobs.length ? ('<div class="table-scroll"><table class="data"><thead><tr>'+
    '<th>Job ID</th><th>Title / Skills</th><th>Client</th><th>Location</th><th>Work Rights</th><th>Type</th><th>Onshore/Offshore</th><th>Priority</th><th>Start Date</th><th>Rate (On/Off)</th><th>Status</th><th>Candidates</th><th></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>') :
    '<div class="empty-state"><h3>No jobs match your filters</h3><p>Try clearing the search or status filter.</p></div>';

  return '<main class="view">'+
    '<div class="view-head"><div><h1>Job Requirements</h1><p>Capture roles and keep their status current.</p></div>'+
      '<button class="btn btn-primary" data-action="open-job-modal">+ New Job</button>'+
    '</div>'+
    '<div class="card">'+
      '<div class="toolbar"><input type="search" placeholder="Search title, client, skills…" data-action="jobs-search" value="'+esc(ui.jobsSearch)+'"><select data-action="jobs-status-filter">'+statusFilterOpts+'</select></div>'+
      body+
    '</div>'+
  '</main>';
}

/* ---------- Candidates view ---------- */
function renderCandidatesView(){
  var cands = state.candidates.slice().sort(function(a,b){ return (b.createdAt||'').localeCompare(a.createdAt||''); });
  var q = ui.candSearch.toLowerCase();
  cands = cands.filter(function(c){
    var job = jobById(state,c.jobId);
    var matchesQ = !q || (c.name+' '+(job?job.title:'')).toLowerCase().indexOf(q)>-1;
    var matchesS = ui.candStatusFilter==='All' || c.status===ui.candStatusFilter;
    var matchesJ = ui.candJobFilter==='All' || c.jobId===ui.candJobFilter;
    return matchesQ && matchesS && matchesJ;
  });

  var statusOpts = ['All'].concat(CANDIDATE_STATUSES.map(function(s){return s.key;})).map(function(s){
    return '<option value="'+esc(s)+'"'+(ui.candStatusFilter===s?' selected':'')+'>'+esc(s)+'</option>';
  }).join('');
  var jobOpts = ['All'].concat(state.jobs.map(function(j){return j.id;})).map(function(id){
    var label = id==='All' ? 'All jobs' : (jobById(state,id)?jobById(state,id).title:id);
    return '<option value="'+esc(id)+'"'+(ui.candJobFilter===id?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');

  var openJobsExist = state.jobs.some(function(j){return j.status==='Open';});

  var rows = cands.map(function(c){
    var job = jobById(state,c.jobId);
    var isTerminal = !!TERMINAL_STATUSES[c.status];
    var actionsHtml = '';
    if(!isTerminal){
      var nexts = STATUS_FLOW[c.status]||[];
      actionsHtml = '<div class="status-actions">'+nexts.map(function(n){
        var isReject = /Reject/.test(n);
        var label = ACTION_LABEL[c.status+'>'+n] || ('Move to '+n);
        return '<button class="btn '+(isReject?'action-reject':'action-forward')+'" data-action="advance-status" data-candidate="'+esc(c.id)+'" data-to="'+esc(n)+'">'+esc(label)+'</button>';
      }).join('')+'</div>';
    } else if(ui.overrideOpenFor===c.id){
      var allOpts = CANDIDATE_STATUSES.map(function(s){return '<option value="'+esc(s.key)+'"'+(s.key===c.status?' selected':'')+'>'+esc(s.key)+'</option>';}).join('');
      actionsHtml = '<div class="status-actions">'+
        '<select data-action="override-select" data-candidate="'+esc(c.id)+'">'+allOpts+'</select>'+
        '<button class="btn btn-primary btn-sm" data-action="override-apply" data-candidate="'+esc(c.id)+'">Apply</button>'+
        '<button class="btn btn-ghost btn-sm" data-action="override-cancel">Cancel</button>'+
      '</div>';
    } else {
      actionsHtml = '<div class="status-actions"><button class="link-btn" data-action="override-open" data-candidate="'+esc(c.id)+'">Reopen / change status</button></div>';
    }
    return '<tr>'+
      '<td class="id-cell">'+esc(c.id)+'</td>'+
      '<td><strong>'+esc(c.name)+'</strong>'+(c.resume?' <span class="muted" title="Resume attached">📎</span>':'')+(c.blacklisted?' <span class="pill stage-bad" title="Blacklisted">Blacklisted</span>':'')+(c.viableFte?' <span class="pill stage-good" title="Viable FTE">Viable FTE</span>':'')+'</td>'+
      '<td>'+(job?esc(job.title):'<span class="muted">Unassigned</span>')+(job?'<div class="muted" style="font-size:.76rem;">'+esc(job.client)+'</div>':'')+'</td>'+
      '<td>'+esc(c.workRights)+'</td>'+
      '<td>'+esc(c.location)+'</td>'+
      '<td>'+esc(c.availability||'–')+'</td>'+
      '<td class="tabular">'+esc(c.cost||'–')+'</td>'+
      '<td><span class="pill '+STATUS_CLASS[c.status]+'">'+esc(c.status)+'</span><div class="muted" style="font-size:.72rem;margin-top:3px;">'+fmtDate(c.updatedAt)+'</div>'+actionsHtml+'</td>'+
      '<td class="row-actions"><button class="btn btn-ghost btn-sm" data-action="open-candidate-modal" data-candidate="'+esc(c.id)+'">Edit</button></td>'+
    '</tr>';
  }).join('');

  var body = cands.length ? ('<div class="table-scroll"><table class="data"><thead><tr>'+
    '<th>ID</th><th>Name</th><th>Job</th><th>Work Rights</th><th>Location</th><th>Availability</th><th>Cost</th><th>Status</th><th></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>') :
    '<div class="empty-state"><h3>No candidates match</h3><p>Adjust filters, or tag a new candidate to a job.</p></div>';

  return '<main class="view">'+
    '<div class="view-head"><div><h1>Candidates</h1><p>Every sourced candidate, tagged to an open requirement.</p></div>'+
      '<button class="btn btn-primary" data-action="open-candidate-modal" '+(openJobsExist?'':'disabled title="Create an open job first"')+'>+ New Candidate</button>'+
    '</div>'+
    '<div class="card">'+
      '<div class="toolbar"><input type="search" placeholder="Search name or job…" data-action="cand-search" value="'+esc(ui.candSearch)+'"><select data-action="cand-status-filter">'+statusOpts+'</select><select data-action="cand-job-filter">'+jobOpts+'</select></div>'+
      body+
    '</div>'+
  '</main>';
}

/* ---------- Job modal ---------- */
function renderJobModal(){
  var editing = ui.jobModal.mode==='edit';
  var j = editing ? jobById(state, ui.jobModal.jobId) : null;
  var defaults = {id:'', title:'', skills:'', client:'', partner:'', location:'', workRights:WORK_RIGHTS_OPTIONS[0], engagementType:'Contract', locationType:'Onshore', startDate:'', duration:'', onshoreRate:'', offshoreRate:'', description:'', status:'Open', priority:'Medium'};
  var v = Object.assign({}, defaults, j||{}, ui.jobModal.formValues||{});
  var errs = ui.fieldErrors;
  function errHtml(f){ return errs[f] ? '<div class="err">'+esc(errs[f])+'</div>' : ''; }
  function inv(f){ return errs[f] ? ' invalid' : ''; }
  var wrOpts = WORK_RIGHTS_OPTIONS.map(function(o){return '<option value="'+esc(o)+'"'+(v.workRights===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');
  var engOpts = ENGAGEMENT_TYPES.map(function(o){return '<option value="'+esc(o)+'"'+(v.engagementType===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');
  var locOpts = LOCATION_TYPES.map(function(o){return '<option value="'+esc(o)+'"'+(v.locationType===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');
  var statusOpts = JOB_STATUSES.map(function(o){return '<option value="'+esc(o)+'"'+(v.status===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');
  var priorityOpts = JOB_PRIORITIES.map(function(o){return '<option value="'+esc(o)+'"'+(v.priority===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');

  return '<div class="overlay" data-action="overlay-close" data-which="job">'+
    '<div class="modal" data-stop="1">'+
      '<div class="modal-head"><div><h2>'+(editing?'Edit Job':'New Job Requirement')+'</h2>'+(editing?'<div class="modal-sub">'+esc(v.id)+'</div>':'')+'</div>'+
        '<button class="btn btn-ghost btn-sm" data-action="close-job-modal" aria-label="Close">✕</button></div>'+
      '<form data-action="submit-job">'+
        '<div class="form-grid">'+
          '<div class="field span-2"><label for="f-title">Title</label><input id="f-title" name="title" class="'+(inv('title')?'invalid':'')+'" value="'+esc(v.title)+'">'+errHtml('title')+'</div>'+
          '<div class="field span-2"><label for="f-skills">Skills</label><input id="f-skills" name="skills" value="'+esc(v.skills)+'" placeholder="e.g. Java, Spring Boot, AWS"><div class="hint">Comma-separated</div></div>'+
          '<div class="field"><label for="f-client">Client</label><input id="f-client" name="client" class="'+(inv('client')?'invalid':'')+'" value="'+esc(v.client)+'">'+errHtml('client')+'</div>'+
          '<div class="field"><label for="f-partner">Partner</label><input id="f-partner" name="partner" value="'+esc(v.partner)+'"></div>'+
          '<div class="field"><label for="f-location">Location</label><input id="f-location" name="location" class="'+(inv('location')?'invalid':'')+'" value="'+esc(v.location)+'">'+errHtml('location')+'</div>'+
          '<div class="field"><label for="f-workrights">Work Rights</label><select id="f-workrights" name="workRights">'+wrOpts+'</select></div>'+
          '<div class="field"><label for="f-engagement">Contract or Perm</label><select id="f-engagement" name="engagementType">'+engOpts+'</select></div>'+
          '<div class="field"><label for="f-locationtype">Onshore or Offshore</label><select id="f-locationtype" name="locationType">'+locOpts+'</select></div>'+
          '<div class="field"><label for="f-startdate">Start Date</label><input type="date" id="f-startdate" name="startDate" value="'+esc(v.startDate)+'"></div>'+
          '<div class="field"><label for="f-duration">Duration</label><input id="f-duration" name="duration" value="'+esc(v.duration)+'" placeholder="e.g. 6 months"></div>'+
          '<div class="field"><label for="f-onshore">Onshore Rate</label><input id="f-onshore" name="onshoreRate" value="'+esc(v.onshoreRate)+'" placeholder="e.g. $120/hr"></div>'+
          '<div class="field"><label for="f-offshore">Offshore Rate</label><input id="f-offshore" name="offshoreRate" value="'+esc(v.offshoreRate)+'" placeholder="e.g. $45/hr"></div>'+
          '<div class="field"><label for="f-status">Job Status</label><select id="f-status" name="status">'+statusOpts+'</select></div>'+
          '<div class="field"><label for="f-priority">Priority</label><select id="f-priority" name="priority">'+priorityOpts+'</select></div>'+
          '<div class="field span-2"><label for="f-desc">Job Description</label><textarea id="f-desc" name="description">'+esc(v.description)+'</textarea></div>'+
        '</div>'+
        '<div class="modal-footer">'+
          (editing ? '<button type="button" class="btn btn-danger" data-action="delete-job" data-job="'+esc(v.id)+'">Delete Job</button>' : '')+
          '<button type="button" class="btn btn-ghost" data-action="close-job-modal">Cancel</button>'+
          '<button type="submit" class="btn btn-primary">Save Job</button>'+
        '</div>'+
      '</form>'+
    '</div>'+
  '</div>';
}

/* ---------- Candidate modal ---------- */
function renderCandidateModal(){
  var editing = ui.candModal.mode==='edit';
  var c = editing ? candidateById(state, ui.candModal.candidateId) : null;
  var defaults = {id:'', name:'', jobId:ui.candModal.presetJobId||'', workRights:WORK_RIGHTS_OPTIONS[0], location:'', availability:'', cost:'', billingRate:'', notes:'', status:'Shortlisted', statusHistory:[], blacklisted:false, viableFte:false};
  var v = Object.assign({}, defaults, c||{}, ui.candModal.formValues||{});
  var errs = ui.fieldErrors;
  function errHtml(f){ return errs[f] ? '<div class="err">'+esc(errs[f])+'</div>' : ''; }
  function inv(f){ return errs[f] ? ' invalid' : ''; }
  var currentResume = getCandidateModalResumeMeta();
  var resumeSection = '<div class="field span-2"><label>Resume</label>'+
    (currentResume ?
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'+
        '<span class="chip">📎 '+esc(currentResume.name)+' · '+fmtBytes(currentResume.size)+'</span>'+
        (isPdfResume(currentResume) ? '<button type="button" class="link-btn" data-action="resume-preview">Preview</button>' : '')+
        '<button type="button" class="link-btn" data-action="resume-remove">Remove</button>'+
      '</div>' : '<div class="hint" style="margin:0 0 6px;">No resume attached.</div>')+
    '<input type="file" accept=".pdf,.doc,.docx,.rtf,.txt" data-action="resume-file-select" style="margin-top:8px;">'+
    '<div class="hint">Keep it under '+fmtBytes(RESUME_MAX_BYTES)+'. PDFs preview inline; other file types are stored but not previewable here.</div>'+
  '</div>';

  var jobChoices = state.jobs.filter(function(j){ return j.status==='Open' || j.id===v.jobId; });
  var jobOpts = jobChoices.map(function(j){
    var label = j.title+' — '+j.client+(j.status!=='Open' ? ' ('+j.status+')' : '');
    return '<option value="'+esc(j.id)+'"'+(v.jobId===j.id?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  var wrOpts = WORK_RIGHTS_OPTIONS.map(function(o){return '<option value="'+esc(o)+'"'+(v.workRights===o?' selected':'')+'>'+esc(o)+'</option>';}).join('');

  var historyHtml = '';
  if(editing && c && c.statusHistory && c.statusHistory.length){
    historyHtml = '<div class="field span-2"><label>History</label><ul class="history-list">'+
      c.statusHistory.slice().reverse().map(function(h){
        return '<li><span class="pill '+STATUS_CLASS[h.status]+'">'+esc(h.status)+'</span><span class="muted">'+fmtDate(h.at)+'</span></li>';
      }).join('')+'</ul></div>';
  }

  return '<div class="overlay" data-action="overlay-close" data-which="candidate">'+
    '<div class="modal" data-stop="1">'+
      '<div class="modal-head"><div><h2>'+(editing?'Edit Candidate':'New Candidate')+'</h2>'+(editing&&c?'<div class="modal-sub">'+esc(c.id)+' · <span class="pill '+STATUS_CLASS[c.status]+'">'+esc(c.status)+'</span></div>':'<div class="modal-sub">New candidates start at Shortlisted</div>')+'</div>'+
        '<button class="btn btn-ghost btn-sm" data-action="close-candidate-modal" aria-label="Close">✕</button></div>'+
      (jobChoices.length===0 && !editing ? '<div class="banner">No open jobs available. Create an open job first.</div>' : '')+
      '<form data-action="submit-candidate">'+
        '<div class="form-grid">'+
          '<div class="field span-2"><label for="c-name">Candidate Name</label><input id="c-name" name="name" class="'+(inv('name')?'invalid':'')+'" value="'+esc(v.name)+'">'+errHtml('name')+'</div>'+
          '<div class="field span-2"><label for="c-job">Job</label><select id="c-job" name="jobId" class="'+(inv('jobId')?'invalid':'')+'">'+jobOpts+'</select>'+errHtml('jobId')+'</div>'+
          '<div class="field"><label for="c-workrights">Work Rights</label><select id="c-workrights" name="workRights">'+wrOpts+'</select></div>'+
          '<div class="field"><label for="c-location">Location</label><input id="c-location" name="location" class="'+(inv('location')?'invalid':'')+'" value="'+esc(v.location)+'">'+errHtml('location')+'</div>'+
          '<div class="field"><label for="c-availability">Availability</label><input id="c-availability" name="availability" value="'+esc(v.availability)+'" placeholder="e.g. Immediate, 2 weeks notice"></div>'+
          '<div class="field"><label for="c-cost">Cost</label><input id="c-cost" name="cost" class="'+(inv('cost')?'invalid':'')+'" value="'+esc(v.cost)+'" placeholder="e.g. $95/hr">'+errHtml('cost')+'</div>'+
          '<div class="field"><label for="c-billing">Billing Rate</label><input id="c-billing" name="billingRate" value="'+esc(v.billingRate)+'" placeholder="e.g. $130/hr"></div>'+
          '<div class="field"><label class="checkbox-label" for="c-blacklisted"><input type="checkbox" id="c-blacklisted" name="blacklisted" value="1" '+(isChecked(v.blacklisted)?'checked':'')+'> Blacklisted</label></div>'+
          '<div class="field"><label class="checkbox-label" for="c-viablefte"><input type="checkbox" id="c-viablefte" name="viableFte" value="1" '+(isChecked(v.viableFte)?'checked':'')+'> Viable FTE</label></div>'+
          resumeSection+
          historyHtml+
          '<div class="field span-2"><label for="c-notes">Notes</label><textarea id="c-notes" name="notes">'+esc(v.notes)+'</textarea></div>'+
        '</div>'+
        '<div class="modal-footer">'+
          (editing ? '<button type="button" class="btn btn-danger" data-action="delete-candidate" data-candidate="'+esc(v.id)+'">Delete Candidate</button>' : '')+
          '<button type="button" class="btn btn-ghost" data-action="close-candidate-modal">Cancel</button>'+
          '<button type="submit" class="btn btn-primary" '+(jobChoices.length===0 && !editing ? 'disabled' : '')+'>Save Candidate</button>'+
        '</div>'+
      '</form>'+
    '</div>'+
  '</div>';
}

/* ---------- Drilldown drawer ---------- */
function renderDrawer(){
  var job = jobById(state, ui.drilldown.jobId);
  var status = ui.drilldown.status;
  var list = candidatesForJob(state, ui.drilldown.jobId);
  if(status!=='__total__') list = list.filter(function(c){return c.status===status;});
  var title = status==='__total__' ? 'All candidates' : status;

  var items = list.map(function(c){
    return '<div class="drawer-candidate">'+
      '<div class="name-row"><strong>'+esc(c.name)+'</strong><span class="pill '+STATUS_CLASS[c.status]+'">'+esc(c.status)+'</span></div>'+
      '<div class="kv">'+
        '<span class="muted">ID</span><span class="tabular">'+esc(c.id)+'</span>'+
        '<span class="muted">Work Rights</span><span>'+esc(c.workRights)+'</span>'+
        '<span class="muted">Location</span><span>'+esc(c.location)+'</span>'+
        '<span class="muted">Availability</span><span>'+esc(c.availability||'–')+'</span>'+
        '<span class="muted">Cost</span><span class="tabular">'+esc(c.cost||'–')+'</span>'+
        '<span class="muted">Billing Rate</span><span class="tabular">'+esc(c.billingRate||'–')+'</span>'+
        '<span class="muted">Blacklisted</span><span>'+(c.blacklisted?'Yes':'No')+'</span>'+
        '<span class="muted">Viable FTE</span><span>'+(c.viableFte?'Yes':'No')+'</span>'+
        '<span class="muted">Resume</span><span>'+(c.resume?('📎 '+esc(c.resume.name)+(isPdfResume(c.resume)?' <button type="button" class="link-btn" data-action="resume-preview" data-candidate="'+esc(c.id)+'">Preview</button>':'')):'–')+'</span>'+
        '<span class="muted">Updated</span><span>'+fmtDate(c.updatedAt)+'</span>'+
      '</div>'+
      (c.notes?'<div class="hint" style="margin-top:8px;white-space:pre-wrap;">'+esc(c.notes)+'</div>':'')+
      '<div style="margin-top:8px;"><button class="btn btn-ghost btn-sm" data-action="open-candidate-modal" data-candidate="'+esc(c.id)+'">Edit</button></div>'+
    '</div>';
  }).join('') || '<p class="muted">No candidates in this stage yet.</p>';

  return '<div class="drawer-overlay" data-action="close-drilldown"></div>'+
    '<aside class="drawer" role="dialog" aria-label="Candidate detail">'+
      '<div class="modal-head"><div><h2>'+esc(title)+'</h2><div class="drawer-sub">'+(job?esc(job.title)+' · '+esc(job.client):'')+' · '+list.length+' candidate'+(list.length===1?'':'s')+'</div></div>'+
      '<button class="btn btn-ghost btn-sm" data-action="close-drilldown" aria-label="Close">✕</button></div>'+
      items+
    '</aside>';
}

/* ---------- Auth screen ---------- */
function renderAuthScreen(){
  var isSignup = ui.authMode==='signup';
  return '<div class="auth-wrap"><div class="auth-card">'+
    '<h1>Viable Recruit Desk</h1>'+
    '<div class="auth-sub">Shared recruiting tracker for the team.</div>'+
    '<div class="auth-tabs" role="tablist">'+
      '<button type="button" data-action="auth-switch" data-mode="login" role="tab" aria-selected="'+(!isSignup)+'">Log in</button>'+
      '<button type="button" data-action="auth-switch" data-mode="signup" role="tab" aria-selected="'+isSignup+'">Join the team</button>'+
    '</div>'+
    (ui.authError ? '<div class="banner bad" style="margin-bottom:14px;">'+esc(ui.authError)+'</div>' : '')+
    (isSignup ?
      '<form data-action="submit-signup">'+
        '<div class="field"><label for="a-name">Your name</label><input id="a-name" name="name" required></div>'+
        '<div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" required></div>'+
        '<div class="field"><label for="a-password">Password</label><input id="a-password" name="password" type="password" minlength="8" required><div class="hint">At least 8 characters.</div></div>'+
        '<div class="field"><label for="a-invite">Team invite code</label><input id="a-invite" name="inviteCode" required><div class="hint">Ask whoever set up the tracker for this.</div></div>'+
        '<button type="submit" class="btn btn-primary btn-block" '+(ui.authBusy?'disabled':'')+'>'+(ui.authBusy?'Creating account…':'Create account')+'</button>'+
      '</form>'
    :
      '<form data-action="submit-login">'+
        '<div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" required></div>'+
        '<div class="field"><label for="l-password">Password</label><input id="l-password" name="password" type="password" required></div>'+
        '<button type="submit" class="btn btn-primary btn-block" '+(ui.authBusy?'disabled':'')+'>'+(ui.authBusy?'Logging in…':'Log in')+'</button>'+
      '</form>'
    )+
  '</div></div>';
}

/* ---------- mutations ---------- */
var JOB_FORM_KEYS = ['title','skills','client','partner','location','workRights','engagementType','locationType','startDate','duration','onshoreRate','offshoreRate','description','status','priority'];
var CAND_FORM_KEYS = ['name','jobId','workRights','location','availability','cost','billingRate','notes','blacklisted','viableFte'];

function createJobFromForm(fd){
  var raw = fdToObj(fd, JOB_FORM_KEYS);
  ui.jobModal.formValues = raw;
  ui.fieldErrors = {};

  var editing = ui.jobModal.mode==='edit';
  var editingJobId = ui.jobModal.jobId;
  var payload = raw;

  runMutation(function(){
    return editing ? api('PUT','/api/jobs/'+encodeURIComponent(editingJobId), payload)
                   : api('POST','/api/jobs', payload);
  }, { onSuccess: function(){ ui.jobModal = null; ui.fieldErrors = {}; } });
}

function createCandidateFromForm(fd){
  var raw = fdToObj(fd, CAND_FORM_KEYS);
  ui.candModal.formValues = raw;
  ui.fieldErrors = {};

  var editing = ui.candModal.mode==='edit';
  var editingCandidateId = ui.candModal.candidateId;

  var form = new FormData();
  CAND_FORM_KEYS.forEach(function(k){ form.append(k, raw[k]); });
  if(ui.candModal.resumeFile) form.append('resume', ui.candModal.resumeFile);
  if(ui.candModal.removeResume) form.append('removeResume', '1');

  runMutation(function(){
    return editing ? api('PUT','/api/candidates/'+encodeURIComponent(editingCandidateId), form, true)
                   : api('POST','/api/candidates', form, true);
  }, { onSuccess: function(){ ui.candModal = null; ui.fieldErrors = {}; } });
}

function changeCandidateStatus(candidateId, newStatus, force){
  runMutation(function(){
    return api('PUT','/api/candidates/'+encodeURIComponent(candidateId)+'/status', {to:newStatus, force:!!force});
  });
}

/* ---------- event delegation ---------- */
document.addEventListener('click', function(e){
  var el = e.target.closest('[data-action]');
  if(!el) return;
  var action = el.getAttribute('data-action');

  if(action==='auth-switch'){ ui.authMode = el.getAttribute('data-mode'); ui.authError=''; renderApp(); return; }
  if(action==='logout'){
    api('POST','/api/auth/logout').then(function(){ user=null; state={jobs:[],candidates:[]}; renderApp(); });
    return;
  }
  if(action==='switch-tab'){ ui.tab = el.getAttribute('data-tab'); ui.overrideOpenFor=null; renderApp(); return; }
  if(action==='open-job-modal'){ ui.jobModal = {mode: el.getAttribute('data-job')?'edit':'new', jobId: el.getAttribute('data-job'), formValues:null}; ui.fieldErrors={}; renderApp(); return; }
  if(action==='close-job-modal'){ ui.jobModal=null; ui.fieldErrors={}; renderApp(); return; }
  if(action==='open-candidate-modal'){
    ui.candModal = {mode: el.getAttribute('data-candidate')?'edit':'new', candidateId: el.getAttribute('data-candidate'), presetJobId: el.getAttribute('data-job')||null, formValues:null, resumeFile:null, removeResume:false};
    ui.fieldErrors={}; renderApp(); return;
  }
  if(action==='close-candidate-modal'){ ui.candModal=null; ui.fieldErrors={}; renderApp(); return; }
  if(action==='overlay-close'){ if(e.target===el){ ui.jobModal=null; ui.candModal=null; ui.fieldErrors={}; renderApp(); } return; }
  if(action==='confirm-yes'){ var yesFn = ui.confirm && ui.confirm.onYes; ui.confirm=null; renderApp(); if(yesFn) yesFn(); return; }
  if(action==='confirm-no'){ ui.confirm=null; renderApp(); return; }
  if(action==='confirm-overlay-close'){ if(e.target===el){ ui.confirm=null; renderApp(); } return; }
  if(action==='jump-candidates'){ ui.tab='candidates'; ui.candJobFilter = el.getAttribute('data-job'); ui.candStatusFilter='All'; renderApp(); return; }

  if(action==='resume-preview'){
    var pcid = el.getAttribute('data-candidate');
    if(pcid){
      var cand = candidateById(state,pcid);
      if(!cand || !cand.resume) return;
      ui.resumePreview = {name:cand.resume.name, size:cand.resume.size, url:'/api/candidates/'+encodeURIComponent(pcid)+'/resume'};
      renderApp();
      return;
    }
    var meta = getCandidateModalResumeMeta();
    if(!meta) return;
    var pvForm = el.closest('form');
    if(pvForm) ui.candModal.formValues = fdToObj(new FormData(pvForm), CAND_FORM_KEYS);
    var url;
    if(ui.candModal.resumeFile){ url = URL.createObjectURL(ui.candModal.resumeFile); }
    else { url = '/api/candidates/'+encodeURIComponent(ui.candModal.candidateId)+'/resume'; }
    ui.resumePreview = {name:meta.name, size:meta.size, url:url};
    renderApp();
    return;
  }
  if(action==='close-resume-preview'){ ui.resumePreview=null; renderApp(); return; }
  if(action==='resume-preview-overlay-close'){ if(e.target===el){ ui.resumePreview=null; renderApp(); } return; }
  if(action==='resume-remove'){
    if(ui.candModal){
      var rmForm = el.closest('form');
      if(rmForm) ui.candModal.formValues = fdToObj(new FormData(rmForm), CAND_FORM_KEYS);
      ui.candModal.resumeFile = null;
      ui.candModal.removeResume = true;
      renderApp();
    }
    return;
  }

  if(action==='open-backup-modal'){ ui.backupOpen = true; renderApp(); return; }
  if(action==='close-backup-modal'){ ui.backupOpen=false; renderApp(); return; }
  if(action==='backup-overlay-close'){ if(e.target===el){ ui.backupOpen=false; renderApp(); } return; }

  if(action==='drilldown'){ ui.drilldown = {jobId: el.getAttribute('data-job'), status: el.getAttribute('data-status')}; renderApp(); return; }
  if(action==='close-drilldown'){ ui.drilldown=null; renderApp(); return; }

  if(action==='delete-job'){
    var jid = el.getAttribute('data-job');
    var job = jobById(state, jid);
    var count = candidatesForJob(state, jid).length;
    if(count>0){ return; }
    askConfirm({
      title:'Delete job', message:'Delete job '+(job?job.title:jid)+'? This can’t be undone.', confirmLabel:'Delete', danger:true,
      onYes: function(){ runMutation(function(){ return api('DELETE','/api/jobs/'+encodeURIComponent(jid)); }, { onSuccess: function(){ ui.jobModal=null; } }); }
    });
    return;
  }
  if(action==='delete-candidate'){
    var cid = el.getAttribute('data-candidate');
    var cand = candidateById(state, cid);
    askConfirm({
      title:'Delete candidate', message:'Delete candidate '+(cand?cand.name:cid)+'? This can’t be undone.', confirmLabel:'Delete', danger:true,
      onYes: function(){ runMutation(function(){ return api('DELETE','/api/candidates/'+encodeURIComponent(cid)); }, { onSuccess: function(){ ui.candModal=null; } }); }
    });
    return;
  }
  if(action==='advance-status'){
    var candId = el.getAttribute('data-candidate');
    var to = el.getAttribute('data-to');
    var cand2 = candidateById(state, candId);
    var label = ACTION_LABEL[(cand2?cand2.status:'')+'>'+to] || ('move to '+to);
    askConfirm({
      title:'Update status', message:(cand2?cand2.name:'this candidate')+' — '+label+'?', confirmLabel:'Confirm',
      onYes: function(){ changeCandidateStatus(candId, to, false); }
    });
    return;
  }
  if(action==='override-open'){ ui.overrideOpenFor = el.getAttribute('data-candidate'); renderApp(); return; }
  if(action==='override-cancel'){ ui.overrideOpenFor = null; renderApp(); return; }
  if(action==='override-apply'){
    var candId2 = el.getAttribute('data-candidate');
    var sel = document.querySelector('select[data-action="override-select"][data-candidate="'+CSS.escape(candId2)+'"]');
    var newStatus = sel ? sel.value : null;
    if(!newStatus) return;
    var cand3 = candidateById(state, candId2);
    if(cand3 && cand3.status===newStatus){ ui.overrideOpenFor=null; renderApp(); return; }
    ui.overrideOpenFor = null;
    askConfirm({
      title:'Override status', message:'Manually set status to “'+newStatus+'”? This bypasses the guided sequence.', confirmLabel:'Set status',
      onYes: function(){ changeCandidateStatus(candId2, newStatus, true); }
    });
    return;
  }
});

document.addEventListener('submit', function(e){
  var el = e.target.closest('[data-action]');
  if(!el) return;
  e.preventDefault();
  var action = el.getAttribute('data-action');
  if(action==='submit-job'){ createJobFromForm(new FormData(el)); return; }
  if(action==='submit-candidate'){ createCandidateFromForm(new FormData(el)); return; }
  if(action==='submit-login'){
    var lfd = new FormData(el);
    ui.authBusy = true; ui.authError=''; renderApp();
    api('POST','/api/auth/login', {email: lfd.get('email'), password: lfd.get('password')}).then(function(data){
      user = data.user; ui.authBusy=false;
      return loadState();
    }).then(function(){ renderApp(); }).catch(function(err){
      ui.authBusy=false; ui.authError = (err && err.message) || 'Could not log in.'; renderApp();
    });
    return;
  }
  if(action==='submit-signup'){
    var sfd = new FormData(el);
    ui.authBusy = true; ui.authError=''; renderApp();
    api('POST','/api/auth/signup', {name: sfd.get('name'), email: sfd.get('email'), password: sfd.get('password'), inviteCode: sfd.get('inviteCode')}).then(function(data){
      user = data.user; ui.authBusy=false;
      return loadState();
    }).then(function(){ renderApp(); }).catch(function(err){
      ui.authBusy=false; ui.authError = (err && err.message) || 'Could not create the account.'; renderApp();
    });
    return;
  }
});

document.addEventListener('change', function(e){
  var el = e.target.closest('[data-action]');
  if(!el) return;
  var action = el.getAttribute('data-action');
  if(action==='jobs-status-filter'){ ui.jobsStatusFilter = el.value; renderApp(); return; }
  if(action==='cand-status-filter'){ ui.candStatusFilter = el.value; renderApp(); return; }
  if(action==='cand-job-filter'){ ui.candJobFilter = el.value; renderApp(); return; }
  if(action==='dash-status-filter'){ ui.dashJobStatusFilter = el.value; renderApp(); return; }
  if(action==='dash-location-filter'){ ui.dashLocationFilter = el.value; renderApp(); return; }
  if(action==='dash-partner-filter'){ ui.dashPartnerFilter = el.value; renderApp(); return; }
  if(action==='dash-cand-status-filter'){ ui.dashCandStatusFilter = el.value; renderApp(); return; }
  if(action==='dash-priority-filter'){ ui.dashPriorityFilter = el.value; renderApp(); return; }
  if(action==='job-status-change'){
    var jid = el.getAttribute('data-job');
    var newStatus = el.value;
    runMutation(function(){ return api('PUT','/api/jobs/'+encodeURIComponent(jid)+'/status', {status:newStatus}); });
    return;
  }
  if(action==='resume-file-select'){
    var file = el.files && el.files[0];
    if(!file) return;
    if(file.size > RESUME_MAX_BYTES){
      pushToast('That file is '+fmtBytes(file.size)+' — resumes must be under '+fmtBytes(RESUME_MAX_BYTES)+'.', 'bad');
      el.value = '';
      return;
    }
    var formEl = el.closest('form');
    if(ui.candModal){
      if(formEl) ui.candModal.formValues = fdToObj(new FormData(formEl), CAND_FORM_KEYS);
      ui.candModal.resumeFile = file;
      ui.candModal.removeResume = false;
      renderApp();
    }
    return;
  }
  if(action==='import-file-select'){
    var ifile = el.files && el.files[0];
    if(!ifile) return;
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(reader.result); }
      catch(err){ pushToast('That doesn’t look like valid JSON.', 'bad'); return; }
      if(!parsed || !Array.isArray(parsed.jobs) || !Array.isArray(parsed.candidates)){
        pushToast('That file doesn’t look like a Viable Recruit Desk backup.', 'bad');
        return;
      }
      askConfirm({
        title:'Restore from backup?',
        message:'This replaces everything currently in the tracker ('+state.jobs.length+' job(s), '+state.candidates.length+' candidate(s)) with the file you selected ('+parsed.jobs.length+' job(s), '+parsed.candidates.length+' candidate(s)). This cannot be undone.',
        confirmLabel:'Restore', danger:true,
        onYes: function(){
          runMutation(function(){ return api('POST','/api/import', parsed); }, {
            onSuccess: function(){ ui.backupOpen=false; pushToast('Backup restored.', 'good'); }
          });
        }
      });
    };
    reader.onerror = function(){ pushToast('Could not read that file.', 'bad'); };
    reader.readAsText(ifile);
    return;
  }
});

document.addEventListener('input', function(e){
  var el = e.target.closest('[data-action]');
  if(!el) return;
  var action = el.getAttribute('data-action');
  if(action==='jobs-search'){ ui.jobsSearch = el.value; rerenderKeepingFocus(); return; }
  if(action==='cand-search'){ ui.candSearch = el.value; rerenderKeepingFocus(); return; }
});
function rerenderKeepingFocus(){
  var a=document.activeElement, pos=null;
  if(a && a.tagName==='INPUT'){ pos={action:a.getAttribute('data-action'), start:a.selectionStart, end:a.selectionEnd}; }
  renderApp();
  if(pos){
    var el=document.querySelector('input[data-action="'+pos.action+'"]');
    if(el){ el.focus(); try{ el.setSelectionRange(pos.start,pos.end); }catch(e){} }
  }
}

document.addEventListener('keydown', function(e){
  if(e.key==='Escape'){
    if(ui.confirm){ ui.confirm=null; renderApp(); }
    else if(ui.resumePreview){ ui.resumePreview=null; renderApp(); }
    else if(ui.backupOpen){ ui.backupOpen=false; renderApp(); }
    else if(ui.jobModal||ui.candModal){ ui.jobModal=null; ui.candModal=null; ui.fieldErrors={}; renderApp(); }
    else if(ui.drilldown){ ui.drilldown=null; renderApp(); }
  }
});

/* ---------- init ---------- */
function init(){
  renderApp();
  api('GET','/api/auth/me').then(function(data){
    user = data.user;
    ui.loading = false;
    if(user) return loadState();
  }).then(function(){
    renderApp();
  }).catch(function(){
    ui.loading = false;
    renderApp();
  });
}
init();

})();
