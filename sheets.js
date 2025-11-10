// sheets.js — Google Sheets sync helpers
// Columns layout (A..N):
// A user_id, B tag, C name, D country, E age, F birth, G income,
// H rank, I balance, J status, K kind, L faction, M created_at, N updated_at

const { google } = require("googleapis");

const SHEET_ID  = process.env.SHEET_ID;          // Google Sheet ID
const SHEET_TAB = process.env.SHEET_TAB || "Users"; // Tab name (worksheet)
const SCOPES    = ["https://www.googleapis.com/auth/spreadsheets"];

let sheets; // google.sheets client (lazy)

function getAuth() {
  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key  = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!client_email || !private_key || !SHEET_ID) {
    console.warn("[sheets] Missing env: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY or SHEET_ID");
    return null;
  }
  const auth = new google.auth.JWT({ email: client_email, key: private_key, scopes: SCOPES });
  sheets = google.sheets({ version: "v4", auth });
  return sheets;
}

async function ensureHeader() {
  if (!getAuth()) return;
  const header = [
    ["user_id","tag","name","country","age","birth","income","rank","balance","status","kind","faction","created_at","updated_at"]
  ];
  // If first row empty, write header
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A1:N1`,
  }).catch(() => null);

  const values = res?.data?.values || [];
  if (!values.length || values[0].length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A1:N1`,
      valueInputOption: "RAW",
      requestBody: { values: header },
    });
  }
}

async function getAllRows() {
  if (!getAuth()) return { header: [], rows: [], values: [] };
  await ensureHeader();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:N`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = res.data.values || [];
  const header = values[0] || [];
  const rows = values.slice(1);
  return { header, rows, values };
}

function rowFromUser(userId, rec, tag) {
  const now = new Date().toISOString();
  return [
    String(userId || ""),
    String(tag || ""),
    String(rec?.name ?? ""),
    String(rec?.country ?? ""),
    rec?.age ?? "",
    String(rec?.birth ?? ""),
    rec?.income ?? 0,
    String(rec?.rank ?? ""),
    rec?.balance ?? 0,
    String(rec?.status ?? ""),
    String(rec?.kind ?? ""),
    String(rec?.faction ?? ""),
    String(rec?.created_at ?? now),
    now,
  ];
}

async function upsertUser(userId, rec, tag) {
  if (!getAuth()) return;
  await ensureHeader();
  const { rows } = await getAllRows();

  // find row index by user_id (A column)
  let rowIndex = -1; // 0-based within "rows" (not counting header)
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || "") === String(userId)) { rowIndex = i; break; }
  }

  const row = rowFromUser(userId, rec, tag);
  if (rowIndex === -1) {
    // append
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A:N`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  } else {
    // update row i (add 2: header is row 1, rows start at row 2)
    const r = rowIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A${r}:N${r}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }
}

async function updateStatus(userId, status) {
  // lightweight update for just the status (J column), still updates "updated_at" (N)
  if (!getAuth()) return;
  const { rows } = await getAllRows();
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || "") === String(userId)) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return; // not found; caller should call upsertUser

  const r = rowIndex + 2;
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${SHEET_TAB}!J${r}:J${r}`, values: [[String(status)]] }, // status
        { range: `${SHEET_TAB}!N${r}:N${r}`, values: [[now]] },             // updated_at
      ],
    },
  });
}

async function updateBalance(userId, balance) {
  if (!getAuth()) return;
  const { rows } = await getAllRows();
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] || "") === String(userId)) { rowIndex = i; break; }
  }
  if (rowIndex === -1) return; // not found; caller should call upsertUser
  const r = rowIndex + 2;
  const now = new Date().toISOString();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${SHEET_TAB}!I${r}:I${r}`, values: [[Number(balance) || 0]] }, // balance
        { range: `${SHEET_TAB}!N${r}:N${r}`, values: [[now]] },                   // updated_at
      ],
    },
  });
}

// Bulk sync (first-time or manual)
async function syncUsers(usersObj) {
  if (!getAuth()) return;
  await ensureHeader();

  const rows = [];
  for (const [userId, rec] of Object.entries(usersObj || {})) {
    rows.push(rowFromUser(userId, rec, rec?.tag || ""));
  }
  if (!rows.length) return;

  // Clear old data (except header), then append fresh snapshot
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:N`,
  });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A2:N`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

module.exports = {
  upsertUser,
  updateStatus,
  updateBalance,
  syncUsers,
};
