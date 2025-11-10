// sheets.js
const { google } = require('googleapis');

let sheets, sheetId;
let initialized = false;

async function init() {
  if (initialized) return;
  const auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  );
  sheets = google.sheets({ version: 'v4', auth });
  sheetId = process.env.SHEET_ID;
  initialized = true;
}

async function ensureHeader() {
  await init();
  // Read first row
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Users!A1:M1',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const need = ['id','name','country','age','birth','income','rank','balance','status','kind','faction','createdAt','updatedAt'];
  const have = (data.values && data.values[0]) || [];
  if (need.every((h, i) => have[i] === h)) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Users!A1:M1',
    valueInputOption: 'RAW',
    requestBody: { values: [need] },
  });
}

async function upsertUser(row) {
  await init();
  await ensureHeader();

  // Find existing row by id
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Users!A2:A',
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const ids = (data.values || []).map(v => String(v[0]));
  const idx = ids.indexOf(String(row.id));

  const values = [[
    row.id, row.name || '', row.country || '', row.age ?? '', row.birth || '',
    row.income ?? 0, row.rank || '', row.balance ?? 0, row.status || '',
    row.kind || '', row.faction || '', row.createdAt || '', row.updatedAt || ''
  ]];

  if (idx === -1) {
    // append
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Users!A2',
      valueInputOption: 'RAW',
      requestBody: { values }
    });
  } else {
    // update in place (row number = idx+2)
    const range = `Users!A${idx+2}:M${idx+2}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId, range,
      valueInputOption: 'RAW', requestBody: { values }
    });
  }
}

async function syncUsers(allUsersObj) {
  await init();
  await ensureHeader();

  const rows = Object.entries(allUsersObj).map(([id,u]) => ([
    id,
    u.name || '', u.country || '', u.age ?? '', u.birth || '',
    u.income ?? 0, u.rank || '', u.balance ?? 0, u.status || '',
    u.kind || '', u.faction || '',
    u.createdAt || '', u.updatedAt || ''
  ]));

  if (!rows.length) return;

  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId, range: 'Users!A2:M'
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId, range: 'Users!A2',
    valueInputOption: 'RAW',
    requestBody: { values: rows }
  });
}

module.exports = { upsertUser, syncUsers };
