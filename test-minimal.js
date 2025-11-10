require('dotenv').config();
const { google } = require('googleapis');

const client_email = process.env.GOOGLE_CLIENT_EMAIL;
const private_key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
const spreadsheet_id = process.env.SHEET_ID;

async function test() {
  const client = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  await client.authorize();
  console.log('✅ Auth successful!');

  const sheets = google.sheets({ version: 'v4', auth: client });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheet_id,
    range: 'Users!A1:Z1',
  });

  console.log('✅ Sheet access successful!');
  console.log('Header:', response.data.values?.[0] || '(empty)');
}

test().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err);
});
