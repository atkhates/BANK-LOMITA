// sheets.js
const { google } = require('googleapis');

let sheets, sheetId;
let initialized = false;

async function init() {
  if (initialized) return;
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
  sheets = google.sheets({ version: 'v4', auth });
  sheetId = process.env.SHEET_ID;
  initialized = true;
}

async function ensureUsersSheet() {
  await init();
  
  // Check if "Users" sheet exists
  try {
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetNames = data.sheets.map(s => s.properties.title);
    
    if (!sheetNames.includes('Users')) {
      console.log('Creating "Users" sheet...');
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Users'
              }
            }
          }]
        }
      });
      console.log('✅ "Users" sheet created');
    }
  } catch (e) {
    console.error('Error ensuring Users sheet:', e.message);
    throw e;
  }
}

async function ensureHeader() {
  await init();
  await ensureUsersSheet();
  
  // Read first row
  try {
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
  } catch (e) {
    console.error('Error setting header:', e.message);
    throw e;
  }
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

async function logTx(entry) {
  try {
    await init();
    const { data } = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetNames = data.sheets.map(s => s.properties.title);
    
    if (!sheetNames.includes('Transactions')) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Transactions'
              }
            }
          }]
        }
      });
    }
    
    const header = ['timestamp', 'type', 'from', 'to', 'amount', 'reason', 'admin'];
    try {
      const { data: headerData } = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'Transactions!A1:G1',
      });
      if (!headerData.values || headerData.values.length === 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: 'Transactions!A1:G1',
          valueInputOption: 'RAW',
          requestBody: { values: [header] },
        });
      }
    } catch (e) {}
    
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Transactions!A2',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          entry.ts || new Date().toISOString(),
          entry.type || '',
          entry.from || '',
          entry.to || '',
          entry.amount || 0,
          entry.reason || '',
          entry.admin || ''
        ]]
      }
    });
  } catch (e) {
    console.error('Error logging transaction to sheets:', e.message);
  }
}

async function onUserChange(userData) {
  try {
    if (!userData || !userData.id) return;
    await upsertUser(userData);
  } catch (e) {
    console.error('Error on user change:', e.message);
  }
}

async function restoreUsersFromSheet() {
  await init();
  await ensureHeader();

  try {
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Users!A2:M',
      valueRenderOption: 'UNFORMATTED_VALUE',
    });

    if (!data.values || data.values.length === 0) {
      return { success: false, message: 'No users found in Google Sheets', count: 0 };
    }

    const users = {};
    data.values.forEach(row => {
      const [id, name, country, age, birth, income, rank, balance, status, kind, faction, createdAt, updatedAt] = row;
      if (id) {
        users[String(id)] = {
          id: String(id),
          name: name || '',
          country: country || '',
          age: age || 0,
          birth: birth || '',
          income: income || 0,
          rank: rank || '',
          balance: balance || 0,
          status: status || '',
          kind: kind || '',
          faction: faction || '',
          createdAt: createdAt || '',
          updatedAt: updatedAt || new Date().toISOString(),
          _daily: {}
        };
      }
    });

    return { success: true, users, count: Object.keys(users).length };
  } catch (e) {
    console.error('Error restoring users from sheets:', e.message);
    return { success: false, message: e.message, count: 0 };
  }
}

module.exports = { upsertUser, syncUsers, logTx, onUserChange, restoreUsersFromSheet };
