// sheets.js — sync users.json with Google Sheets
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SA_KEY   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

const HEADERS = [
  "UserID","Name","Country","Age","Birth","Income",
  "Rank","Balance","Status","Kind","Faction","UpdatedAt"
];

function enabled() {
  return !!(process.env.SHEET_SYNC && SHEET_ID && SA_EMAIL && SA_KEY);
}

async function getClient() {
  const auth = new google.auth.JWT(
    SA_EMAIL,
    null,
    SA_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeader(sheets) {
  const range = 'Users!A1:L1';
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range });
    // if present do nothing
  } catch {
    // create sheet or header
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: 'Users' } } }],
      },
    }).catch(() => {}); // sheet may already exist

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
  }
}

function rowFromRecord(id, u) {
  return [
    id,
    u.name || '',
    u.country || '',
    typeof u.age === 'number' ? u.age : '',
    u.birth || '',
    typeof u.income === 'number' ? u.income : '',
    u.rank || '',
    typeof u.balance === 'number' ? u.balance : '',
    u.status || '',
    u.kind || '',
    u.faction || '',
    new Date().toISOString(),
  ];
}

async function syncUsers(usersObj) {
  if (!enabled()) return;

  const sheets = await getClient();
  await ensureHeader(sheets);

  // Fetch existing rows to detect upserts
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Users!A2:A', // column A holds UserID
    majorDimension: 'ROWS',
  }).catch(() => ({ data: {} }));

  const existingIds = new Map(); // id -> rowIndex (starting at 2)
  const rows = (read.data.values || []);
  rows.forEach((r, i) => {
    const id = r[0];
    if (id) existingIds.set(id, i + 2);
  });

  const updates = [];
  const appends = [];

  for (const [id, u] of Object.entries(usersObj || {})) {
    const row = rowFromRecord(id, u);
    const at = existingIds.get(id);
    if (at) {
      updates.push({ at, row });
    } else {
      appends.push(row);
    }
  }

  // Batch updates
  for (const chunk of updates) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Users!A${chunk.at}:L${chunk.at}`,
      valueInputOption: 'RAW',
      requestBody: { values: [chunk.row] },
    });
  }

  if (appends.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Users!A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: appends },
    });
  }
}

module.exports = { syncUsers, enabled };
